import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const client = new DynamoDBClient({ region: "ap-south-1" });
const db     = DynamoDBDocumentClient.from(client);
const sns    = new SNSClient({ region: "ap-south-1" });

// ── CORS headers — on every response ──
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "*"
};

// ── Structured JSON Logger ──
const log = (level, message, meta = {}) => {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service:   "addProduct",
    ...meta
  }));
};

// ── Input Validator ──
function validateProduct(body) {
  const errors = [];
  if (!body)                              errors.push("Request body is required");
  if (!body?.productId?.trim())           errors.push("productId is required");
  if (!body?.productName?.trim())         errors.push("productName is required");
  if (!body?.category?.trim())            errors.push("category is required");
  if (body?.productId?.length > 50)       errors.push("productId must be 50 characters or less");
  if (body?.productName?.length > 100)    errors.push("productName must be 100 characters or less");

  const stock = Number(body?.currentStock);
  if (body?.currentStock === undefined || body?.currentStock === null || body?.currentStock === "")
                                          errors.push("currentStock is required");
  else if (isNaN(stock))                  errors.push("currentStock must be a number");
  else if (stock < 0)                     errors.push("currentStock cannot be negative");
  else if (!Number.isInteger(stock))      errors.push("currentStock must be a whole number");
  else if (stock > 999999)                errors.push("currentStock cannot exceed 999,999");

  const threshold = Number(body?.thresholdLevel);
  if (body?.thresholdLevel === undefined || body?.thresholdLevel === null || body?.thresholdLevel === "")
                                          errors.push("thresholdLevel is required");
  else if (isNaN(threshold))              errors.push("thresholdLevel must be a number");
  else if (threshold < 0)                 errors.push("thresholdLevel cannot be negative");
  else if (!Number.isInteger(threshold))  errors.push("thresholdLevel must be a whole number");

  return errors;
}

export const handler = async (event, context) => {

  log("INFO", "Add product request received", {
    requestId: context.awsRequestId
  });

  // ── Handle OPTIONS preflight ──
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  // ── Parse body ──
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    log("WARN", "Invalid JSON in request body", { requestId: context.awsRequestId });
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "Invalid JSON in request body" })
    };
  }

  // ── Validate input ──
  const errors = validateProduct(body);
  if (errors.length > 0) {
    log("WARN", "Validation failed", { requestId: context.awsRequestId, errors });
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "Validation failed", errors })
    };
  }

  const product = {
    productId:      body.productId.trim(),
    productName:    body.productName.trim(),
    category:       body.category.trim(),
    currentStock:   Number(body.currentStock),
    thresholdLevel: Number(body.thresholdLevel),
    createdAt:      new Date().toISOString()
  };

  try {

    // ── Check for duplicate productId ──
    const existing = await client.send(new GetItemCommand({
      TableName: "Products",
      Key: { productId: { S: product.productId } }
    }));

    if (existing.Item) {
      log("WARN", "Duplicate productId rejected", {
        requestId: context.awsRequestId,
        productId: product.productId
      });
      return {
        statusCode: 409,
        headers: CORS,
        body: JSON.stringify({
          message: `Product ID "${product.productId}" already exists. Use a different ID.`
        })
      };
    }

    // ── Step 1: Add to Products table ──
    await db.send(new PutCommand({
      TableName: "Products",
      Item: product
    }));

    log("INFO", "Product added to Products table", {
      requestId:      context.awsRequestId,
      productId:      product.productId,
      productName:    product.productName,
      currentStock:   product.currentStock,
      thresholdLevel: product.thresholdLevel
    });

    // ── Step 2: Write ADD transaction to TransactionsTable ──
    const txnId     = "TXN-" + context.awsRequestId.substring(0, 8).toUpperCase();
    const timestamp = new Date().toISOString();

    await client.send(new PutItemCommand({
      TableName: "TransactionsTable",
      Item: {
        productId:     { S: product.productId },
        timestamp:     { S: timestamp },
        txnId:         { S: txnId },
        action:        { S: "ADD" },
        productName:   { S: product.productName },
        previousStock: { N: "0" },
        newStock:      { N: product.currentStock.toString() },
        quantity:      { N: product.currentStock.toString() },
        performedBy:   { S: "user" },
        service:       { S: "addProduct" }
      }
    }));

    log("INFO", "ADD transaction recorded in TransactionsTable", {
      requestId: context.awsRequestId,
      txnId,
      productId: product.productId
    });

    // ── Step 3: SNS alert if stock already below threshold ──
    if (product.currentStock < product.thresholdLevel) {
      await sns.send(new PublishCommand({
        TopicArn: "arn:aws:sns:ap-south-1:971476709086:low-stock-alert",
        Subject:  "⚠ Low Stock Alert — New Product Added",
        Message:  `Product "${product.productName}" was added with stock already below threshold.\nStock: ${product.currentStock}\nThreshold: ${product.thresholdLevel}\nProduct ID: ${product.productId}`
      }));

      log("WARN", "SNS low-stock alert sent for new product", {
        requestId:      context.awsRequestId,
        productId:      product.productId,
        productName:    product.productName,
        currentStock:   product.currentStock,
        thresholdLevel: product.thresholdLevel
      });
    }

    // ── Success response ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message:     "Product added successfully",
        txnId,
        productId:   product.productId,
        productName: product.productName
      })
    };

  } catch (error) {

    log("ERROR", "Failed to add product", {
      requestId: context.awsRequestId,
      productId: body?.productId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Error adding product",
        error:   error.message
      })
    };
  }
};
