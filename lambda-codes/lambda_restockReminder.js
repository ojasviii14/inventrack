import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const client = new DynamoDBClient({ region: "ap-south-1" });
const sns    = new SNSClient({ region: "ap-south-1" });

// ── CORS headers ──
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "*"
};

// ── Structured Logger ──
const log = (level, message, meta = {}) => {
  console.log(JSON.stringify({
    level, message,
    timestamp: new Date().toISOString(),
    service: "restockReminder",
    ...meta
  }));
};

export const handler = async (event, context) => {

  log("INFO", "Daily restock reminder triggered by EventBridge", {
    requestId: context.awsRequestId,
    scheduledTime: event?.time || new Date().toISOString()
  });

  try {

    // ── Scan all products ──
    const result = await client.send(new ScanCommand({
      TableName: "Products"
    }));

    const products = result.Items.map(item => ({
      productId:      item.productId.S,
      productName:    item.productName.S,
      category:       item.category.S,
      currentStock:   Number(item.currentStock.N),
      thresholdLevel: Number(item.thresholdLevel.N)
    }));

    const lowStock = products.filter(p => p.currentStock < p.thresholdLevel);
    const critical = products.filter(p => p.currentStock < p.thresholdLevel * 0.5);
    const healthy  = products.filter(p => p.currentStock >= p.thresholdLevel);
    const healthScore = Math.round((healthy.length / products.length) * 100);

    log("INFO", "Products scanned for daily reminder", {
      requestId:     context.awsRequestId,
      total:         products.length,
      lowStockCount: lowStock.length,
      criticalCount: critical.length,
      healthScore:   healthScore + "%"
    });

    // ── Skip email if everything is healthy ──
    if (lowStock.length === 0) {
      log("INFO", "All products healthy — skipping reminder email", {
        requestId: context.awsRequestId
      });
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          message: "All products healthy — no reminder sent",
          total:   products.length,
          healthy: healthy.length
        })
      };
    }

    // ── Build email body ──
    const today = new Date().toLocaleDateString("en-IN", {
      weekday: "long", year: "numeric",
      month: "long", day: "numeric"
    });

    const criticalSection = critical.length > 0
      ? `\n🚨 CRITICAL (below 50% threshold):\n${critical.map(p =>
          `  • ${p.productName} (${p.category}) — Stock: ${p.currentStock} / Threshold: ${p.thresholdLevel}`
        ).join("\n")}\n`
      : "";

    const lowSection = lowStock.filter(p => p.currentStock >= p.thresholdLevel * 0.5).length > 0
      ? `\n⚠ LOW STOCK:\n${lowStock.filter(p => p.currentStock >= p.thresholdLevel * 0.5).map(p =>
          `  • ${p.productName} (${p.category}) — Stock: ${p.currentStock} / Threshold: ${p.thresholdLevel}`
        ).join("\n")}\n`
      : "";

    const emailMessage = `
InvenTrack — Daily Inventory Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Date          : ${today}
System Health : ${healthScore}%
Total Products: ${products.length}
Healthy       : ${healthy.length}
Low Stock     : ${lowStock.length}
Critical      : ${critical.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${criticalSection}${lowSection}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please login to InvenTrack to restock the above items.
https://d105iz30cenct6.cloudfront.net

This is an automated daily digest from InvenTrack.
Powered by AWS Lambda + EventBridge + SNS
    `.trim();

    // ── Send SNS email ──
    await sns.send(new PublishCommand({
      TopicArn: "arn:aws:sns:ap-south-1:971476709086:low-stock-alert",
      Subject:  `📦 InvenTrack Daily Report — ${lowStock.length} item(s) need restock · ${today}`,
      Message:  emailMessage
    }));

    log("INFO", "Daily restock reminder email sent", {
      requestId:     context.awsRequestId,
      lowStockCount: lowStock.length,
      criticalCount: critical.length,
      healthScore:   healthScore + "%"
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message:       "Daily reminder sent successfully",
        lowStockCount: lowStock.length,
        criticalCount: critical.length,
        healthScore:   healthScore + "%",
        sentAt:        new Date().toISOString()
      })
    };

  } catch (error) {

    log("ERROR", "Daily restock reminder failed", {
      requestId: context.awsRequestId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Restock reminder failed",
        error:   error.message
      })
    };
  }
};
