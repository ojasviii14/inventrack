import { DynamoDBClient, DeleteItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

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
    service:   "deleteProduct",
    ...meta
  }));
};

// ── Input Validator ──
function validateDelete(body) {
  const errors = [];
  if (!body?.productId?.trim()) errors.push("productId is required");
  if (body?.productId?.length > 50) errors.push("productId must be 50 characters or less");
  return errors;
}

export const handler = async (event, context) => {

  log("INFO", "Delete product request received", {
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
  const errors = validateDelete(body);
  if (errors.length > 0) {
    log("WARN", "Validation failed", { requestId: context.awsRequestId, errors });
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "Validation failed", errors })
    };
  }

  const { productId } = body;

  try {

    // ── Step 1: Get product details before deleting ──
    const existing = await client.send(new GetItemCommand({
      TableName: "Products",
      Key: { productId: { S: productId } }
    }));

    if (!existing.Item) {
      log("WARN", "Product not found for deletion", {
        requestId: context.awsRequestId,
        productId
      });
      return {
        statusCode: 404,
        headers: CORS,
        body: JSON.stringify({
          message: `Product "${productId}" not found`
        })
      };
    }

    const productName = existing.Item.productName?.S || productId;
    const lastStock   = existing.Item.currentStock
      ? Number(existing.Item.currentStock.N)
      : 0;

    log("INFO", "Fetched product before delete", {
      requestId: context.awsRequestId,
      productId,
      productName,
      lastStock
    });

    // ── Step 2: Delete from Products table ──
    await client.send(new DeleteItemCommand({
      TableName: "Products",
      Key: { productId: { S: productId } }
    }));

    log("INFO", "Product deleted from Products table", {
      requestId: context.awsRequestId,
      productId,
      productName
    });

    // ── Step 3: Write DELETE transaction to TransactionsTable ──
    const timestamp = new Date().toISOString();
    const txnId     = "TXN-" + context.awsRequestId.substring(0, 8).toUpperCase();

    await client.send(new PutItemCommand({
      TableName: "TransactionsTable",
      Item: {
        productId:     { S: productId },
        timestamp:     { S: timestamp },
        txnId:         { S: txnId },
        action:        { S: "DELETE" },
        productName:   { S: productName },
        previousStock: { N: lastStock.toString() },
        newStock:      { N: "0" },
        quantity:      { N: lastStock.toString() },
        performedBy:   { S: "user" },
        service:       { S: "deleteProduct" }
      }
    }));

    log("INFO", "DELETE transaction recorded in TransactionsTable", {
      requestId: context.awsRequestId,
      txnId,
      productId,
      productName
    });

    // ── Success response ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message: "Product deleted successfully",
        txnId,
        productId,
        productName
      })
    };

  } catch (error) {

    log("ERROR", "Failed to delete product", {
      requestId: context.awsRequestId,
      productId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Error deleting product",
        error:   error.message
      })
    };
  }
};
