import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

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
    service:   "getProducts",
    ...meta
  }));
};

export const handler = async (event, context) => {

  log("INFO", "Get all products request received", {
    requestId: context.awsRequestId
  });

  // ── Handle OPTIONS preflight ──
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {

    const t0   = Date.now();
    const data = await client.send(new ScanCommand({ TableName: "Products" }));
    const latency = Date.now() - t0;

    const products = data.Items.map(item => ({
      productId:      item.productId.S,
      productName:    item.productName.S,
      category:       item.category.S,
      currentStock:   Number(item.currentStock.N),
      thresholdLevel: Number(item.thresholdLevel.N),
      createdAt:      item.createdAt?.S || new Date().toISOString()
    }));

    const lowCount  = products.filter(p => p.currentStock < p.thresholdLevel).length;
    const critCount = products.filter(p => p.currentStock < p.thresholdLevel * 0.5).length;

    log("INFO", "Products scanned successfully", {
      requestId:       context.awsRequestId,
      totalProducts:   products.length,
      lowStockCount:   lowCount,
      criticalCount:   critCount,
      dynamoLatencyMs: latency,
      scannedCount:    data.ScannedCount
    });

    if (lowCount > 0) {
      log("WARN", `${lowCount} product(s) below threshold`, {
        requestId:     context.awsRequestId,
        lowStockCount: lowCount,
        criticalCount: critCount
      });
    }

    // ── Success response ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(products)
    };

  } catch (error) {

    log("ERROR", "Failed to fetch products", {
      requestId: context.awsRequestId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Error retrieving products",
        error:   error.message
      })
    };
  }
};
