import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const client = new DynamoDBClient({ region: "ap-south-1" });
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
    service:   "getLowStockProducts",
    ...meta
  }));
};

export const handler = async (event, context) => {

  log("INFO", "Get low stock products request received", {
    requestId: context.awsRequestId
  });

  // ── Handle OPTIONS preflight ──
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {

    const t0     = Date.now();
    const result = await client.send(new ScanCommand({
      TableName: "Products"
    }));
    const latency = Date.now() - t0;

    const items = result.Items.map(i => ({
      productId:      i.productId.S,
      productName:    i.productName.S,
      category:       i.category.S,
      currentStock:   Number(i.currentStock.N),
      thresholdLevel: Number(i.thresholdLevel.N)
    }));

    const lowStock  = items.filter(p => p.currentStock < p.thresholdLevel);
    const critical  = items.filter(p => p.currentStock < p.thresholdLevel * 0.5);

    log("INFO", "Low stock products fetched", {
      requestId:       context.awsRequestId,
      totalScanned:    items.length,
      lowStockCount:   lowStock.length,
      criticalCount:   critical.length,
      dynamoLatencyMs: latency
    });

    // ── Warn log for each critical item ──
    critical.forEach(p => {
      log("WARN", "Critical stock level detected", {
        requestId:      context.awsRequestId,
        productId:      p.productId,
        productName:    p.productName,
        currentStock:   p.currentStock,
        thresholdLevel: p.thresholdLevel
      });
    });

    // ── SNS alert for critical items ──
    if (critical.length > 0) {
      const criticalList = critical
        .map(p => `• ${p.productName} — Stock: ${p.currentStock} / Threshold: ${p.thresholdLevel}`)
        .join("\n");

      await sns.send(new PublishCommand({
        TopicArn: "arn:aws:sns:ap-south-1:971476709086:low-stock-alert",
        Subject:  `🚨 ${critical.length} Critical Stock Item(s) Detected`,
        Message:  `The following products are critically low (below 50% of threshold):\n\n${criticalList}\n\nPlease restock immediately.`
      }));

      log("WARN", "SNS critical stock alert sent", {
        requestId:     context.awsRequestId,
        criticalCount: critical.length
      });
    }

    // ── Success response ──
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(lowStock)
    };

  } catch (error) {

    log("ERROR", "Failed to fetch low stock products", {
      requestId: context.awsRequestId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Error fetching low stock products",
        error:   error.message
      })
    };
  }
};
