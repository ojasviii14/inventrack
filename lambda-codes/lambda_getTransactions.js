import { DynamoDBClient, ScanCommand, QueryCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "ap-south-1" });

// ── Structured JSON Logger ──
const log = (level, message, meta = {}) => {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "getTransactions",
    ...meta
  }));
};

export const handler = async (event, context) => {

  log("INFO", "Get transactions request received", {
    requestId:   context.awsRequestId,
    queryParams: event.queryStringParameters
  });

  // ── Parse query parameters ──
  const params     = event.queryStringParameters || {};
  const productId  = params.productId  || null;  // filter by product
  const action     = params.action     || null;  // STOCK_IN, STOCK_OUT, ADD, DELETE
  const limitParam = parseInt(params.limit) || 50;
  const limit      = Math.min(limitParam, 200);  // max 200

  try {

    let items = [];
    const t0 = Date.now();

    if (productId) {
      // ── Query by productId (uses primary key — efficient) ──
      const result = await client.send(new QueryCommand({
        TableName:              "TransactionsTable",
        KeyConditionExpression: "productId = :pid",
        ExpressionAttributeValues: {
          ":pid": { S: productId }
        },
        ScanIndexForward: false, // newest first
        Limit: limit
      }));
      items = result.Items || [];

    } else {
      // ── Scan all transactions ──
      const result = await client.send(new ScanCommand({
        TableName: "TransactionsTable",
        Limit:     limit
      }));
      items = result.Items || [];
    }

    const latency = Date.now() - t0;

    // ── Parse DynamoDB items ──
    let transactions = items.map(item => ({
      productId:     item.productId?.S     || "",
      timestamp:     item.timestamp?.S     || "",
      txnId:         item.txnId?.S         || "",
      action:        item.action?.S        || "",
      productName:   item.productName?.S   || "",
      previousStock: Number(item.previousStock?.N || 0),
      newStock:      Number(item.newStock?.N || 0),
      quantity:      Number(item.quantity?.N || 0),
      performedBy:   item.performedBy?.S   || "system",
      service:       item.service?.S       || ""
    }));

    // ── Filter by action if provided ──
    if (action) {
      transactions = transactions.filter(t => t.action === action);
    }

    // ── Sort by timestamp descending ──
    transactions.sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    // ── Build summary stats ──
    const summary = {
      total:     transactions.length,
      stockIn:   transactions.filter(t => t.action === "STOCK_IN").length,
      stockOut:  transactions.filter(t => t.action === "STOCK_OUT").length,
      added:     transactions.filter(t => t.action === "ADD").length,
      deleted:   transactions.filter(t => t.action === "DELETE").length
    };

    log("INFO", "Transactions fetched successfully", {
      requestId:      context.awsRequestId,
      count:          transactions.length,
      productId:      productId || "all",
      dynamoLatencyMs: latency
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*"
      },
      body: JSON.stringify({
        message:      "Transactions fetched successfully",
        transactions,
        summary,
        count:        transactions.length,
        generatedAt:  new Date().toISOString()
      })
    };

  } catch (error) {

    log("ERROR", "Failed to fetch transactions", {
      requestId: context.awsRequestId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*"
      },
      body: JSON.stringify({
        message: "Error fetching transactions",
        error:   error.message
      })
    };
  }
};
