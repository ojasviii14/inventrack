import { DynamoDBClient, UpdateItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "ap-south-1" });

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
    service:   "updateProduct",
    ...meta
  }));
};

// ── Input Validator ──
function validateUpdate(body) {
  const errors = [];

  if (!body?.productId?.trim())
    errors.push("productId is required");

  if (body?.currentStock === undefined || body?.currentStock === null || body?.currentStock === "")
    errors.push("currentStock is required");
  else {
    const stock = Number(body.currentStock);
    if (isNaN(stock))             errors.push("currentStock must be a number");
    else if (stock < 0)           errors.push("currentStock cannot be negative");
    else if (!Number.isInteger(stock)) errors.push("currentStock must be a whole number");
    else if (stock > 999999)      errors.push("currentStock cannot exceed 999,999");
  }

  return errors;
}

export const handler = async (event, context) => {

  log("INFO", "Update stock request received", {
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
  const errors = validateUpdate(body);
  if (errors.length > 0) {
    log("WARN", "Validation failed", { requestId: context.awsRequestId, errors });
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "Validation failed", errors })
    };
  }

  const { productId } = body;
  const newStock = Number(body.currentStock);

  try {

    // ── Step 1: Get existing product before updating ──
    const existing = await client.send(new GetItemCommand({
      TableName: "Products",
      Key: { productId: { S: productId } }
    }));

    if (!existing.Item) {
      log("WARN", "Product not found", { requestId: context.awsRequestId, productId });
      return {
        statusCode: 404,
        headers: CORS,
        body: JSON.stringify({
          message: `Product "${productId}" not found`
        })
      };
    }

    const oldStock    = Number(existing.Item.currentStock.N);
    const productName = existing.Item.productName?.S || productId;
    const threshold   = existing.Item.thresholdLevel
      ? Number(existing.Item.thresholdLevel.N)
      : null;

    log("INFO", "Fetched existing product", {
      requestId: context.awsRequestId,
      productId,
      productName,
      oldStock
    });

    // ── Step 2: Update stock in Products table ──
    await client.send(new UpdateItemCommand({
      TableName: "Products",
      Key: { productId: { S: productId } },
      UpdateExpression: "SET currentStock = :s",
      ExpressionAttributeValues: {
        ":s": { N: newStock.toString() }
      }
    }));

    log("INFO", "Stock updated in Products table", {
      requestId: context.awsRequestId,
      productId,
      oldStock,
      newStock
    });

    // ── Step 3: Write to TransactionsTable ──
    const action    = newStock > oldStock ? "STOCK_IN" : "STOCK_OUT";
    const quantity  = Math.abs(newStock - oldStock);
    const timestamp = new Date().toISOString();
    const txnId     = "TXN-" + context.awsRequestId.substring(0, 8).toUpperCase();

    await client.send(new PutItemCommand({
      TableName: "TransactionsTable",
      Item: {
        productId:     { S: productId },
        timestamp:     { S: timestamp },
        txnId:         { S: txnId },
        action:        { S: action },
        productName:   { S: productName },
        previousStock: { N: oldStock.toString() },
        newStock:      { N: newStock.toString() },
        quantity:      { N: quantity.toString() },
        performedBy:   { S: "user" },
        service:       { S: "updateProduct" }
      }
    }));

    log("INFO", "Transaction recorded in TransactionsTable", {
      requestId: context.awsRequestId,
      txnId,
      action,
      productId,
      quantity,
      oldStock,
      newStock
    });

    // ── Step 4: Warn if stock dropped below threshold ──
    if (threshold !== null && newStock < threshold) {
      log("WARN", "Stock below threshold after update", {
        requestId: context.awsRequestId,
        productId,
        productName,
        newStock,
        threshold
      });
    }

    // ── Success response ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message:   "Stock updated successfully",
        txnId,
        action,
        productId,
        productName,
        oldStock,
        newStock,
        quantity
      })
    };

  } catch (error) {

    log("ERROR", "Failed to update stock", {
      requestId: context.awsRequestId,
      productId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Error updating stock",
        error:   error.message
      })
    };
  }
};
