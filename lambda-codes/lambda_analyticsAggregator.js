import { DynamoDBClient, ScanCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const client = new DynamoDBClient({ region: "ap-south-1" });
const sns    = new SNSClient({ region: "ap-south-1" });

// ── Structured JSON Logger ──
const log = (level, message, meta = {}) => {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "analyticsAggregator",
    ...meta
  }));
};

export const handler = async (event, context) => {

  log("INFO", "Analytics aggregator triggered by EventBridge", {
    requestId: context.awsRequestId,
    scheduledTime: event?.time || new Date().toISOString()
  });

  try {

    // ── Step 1: Scan all products ──
    const t0     = Date.now();
    const result = await client.send(new ScanCommand({ TableName: "Products" }));
    const latency = Date.now() - t0;

    const products = result.Items.map(item => ({
      productId:      item.productId.S,
      productName:    item.productName.S,
      category:       item.category.S,
      currentStock:   Number(item.currentStock.N),
      thresholdLevel: Number(item.thresholdLevel.N),
      createdAt:      item.createdAt?.S || ""
    }));

    log("INFO", "Products scanned for analytics", {
      requestId:       context.awsRequestId,
      totalProducts:   products.length,
      dynamoLatencyMs: latency
    });

    // ── Step 2: Compute analytics ──
    const totalProducts  = products.length;
    const totalUnits     = products.reduce((s, p) => s + p.currentStock, 0);
    const lowStockItems  = products.filter(p => p.currentStock < p.thresholdLevel);
    const criticalItems  = products.filter(p => p.currentStock < p.thresholdLevel * 0.5);
    const healthyItems   = products.filter(p => p.currentStock >= p.thresholdLevel);
    const avgStock       = totalProducts ? Math.round(totalUnits / totalProducts) : 0;
    const healthScore    = totalProducts ? Math.round((healthyItems.length / totalProducts) * 100) : 100;

    // Category breakdown
    const categoryMap = {};
    products.forEach(p => {
      if (!categoryMap[p.category]) {
        categoryMap[p.category] = { count: 0, totalStock: 0, lowCount: 0 };
      }
      categoryMap[p.category].count++;
      categoryMap[p.category].totalStock += p.currentStock;
      if (p.currentStock < p.thresholdLevel) categoryMap[p.category].lowCount++;
    });

    // Fast movers (stock close to or below threshold)
    const fastMovers = [...products]
      .sort((a, b) => {
        const ra = a.currentStock / Math.max(a.thresholdLevel, 1);
        const rb = b.currentStock / Math.max(b.thresholdLevel, 1);
        return ra - rb;
      })
      .slice(0, 5)
      .map(p => ({
        productId:    p.productId,
        productName:  p.productName,
        currentStock: p.currentStock,
        thresholdLevel: p.thresholdLevel,
        ratio: parseFloat((p.currentStock / Math.max(p.thresholdLevel, 1)).toFixed(2))
      }));

    // Slow movers (stock well above threshold)
    const slowMovers = [...products]
      .sort((a, b) => {
        const ra = a.currentStock / Math.max(a.thresholdLevel, 1);
        const rb = b.currentStock / Math.max(b.thresholdLevel, 1);
        return rb - ra;
      })
      .slice(0, 5)
      .map(p => ({
        productId:    p.productId,
        productName:  p.productName,
        currentStock: p.currentStock,
        thresholdLevel: p.thresholdLevel,
        ratio: parseFloat((p.currentStock / Math.max(p.thresholdLevel, 1)).toFixed(2))
      }));

    log("INFO", "Analytics computed", {
      requestId:       context.awsRequestId,
      totalProducts,
      totalUnits,
      lowStockCount:   lowStockItems.length,
      criticalCount:   criticalItems.length,
      healthScore:     healthScore + "%",
      avgStock,
      categoriesCount: Object.keys(categoryMap).length
    });

    // ── Step 3: Save analytics snapshot to AnalyticsTable ──
    const timestamp  = new Date().toISOString();
    const dateKey    = timestamp.split("T")[0]; // e.g. "2026-05-06"
    const hourKey    = timestamp.substring(0, 13); // e.g. "2026-05-06T10"

    await client.send(new PutItemCommand({
      TableName: "AnalyticsTable",
      Item: {
        snapshotId:      { S: `SNAPSHOT-${hourKey}` },
        timestamp:       { S: timestamp },
        dateKey:         { S: dateKey },
        hourKey:         { S: hourKey },
        totalProducts:   { N: totalProducts.toString() },
        totalUnits:      { N: totalUnits.toString() },
        lowStockCount:   { N: lowStockItems.length.toString() },
        criticalCount:   { N: criticalItems.length.toString() },
        healthyCount:    { N: healthyItems.length.toString() },
        healthScore:     { N: healthScore.toString() },
        avgStock:        { N: avgStock.toString() },
        categoryBreakdown: { S: JSON.stringify(categoryMap) },
        fastMovers:      { S: JSON.stringify(fastMovers) },
        slowMovers:      { S: JSON.stringify(slowMovers) },
        service:         { S: "analyticsAggregator" },
        ttl:             { N: String(Math.floor(Date.now()/1000) + 7776000) } // 90 days
      }
    }));

    log("INFO", "Analytics snapshot saved to AnalyticsTable", {
      requestId:  context.awsRequestId,
      snapshotId: `SNAPSHOT-${hourKey}`,
      dateKey,
      hourKey
    });

    // ── Step 4: Warn logs for critical items ──
    criticalItems.forEach(p => {
      log("WARN", "Critical stock level in analytics scan", {
        requestId:      context.awsRequestId,
        productId:      p.productId,
        productName:    p.productName,
        currentStock:   p.currentStock,
        thresholdLevel: p.thresholdLevel
      });
    });

    // ── Step 5: Send SNS summary if critical items exist ──
    if (criticalItems.length > 0) {

      const criticalList = criticalItems
        .map(p => `• ${p.productName} — Stock: ${p.currentStock} / Threshold: ${p.thresholdLevel}`)
        .join("\n");

      await sns.send(new PublishCommand({
        TopicArn: "arn:aws:sns:ap-south-1:971476709086:low-stock-alert",
        Subject:  `🚨 InvenTrack Analytics Report — ${criticalItems.length} Critical Item(s)`,
        Message:  `InvenTrack Hourly Analytics Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated: ${timestamp}
Total Products : ${totalProducts}
Total Units    : ${totalUnits}
Low Stock      : ${lowStockItems.length}
Critical       : ${criticalItems.length}
Health Score   : ${healthScore}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL ITEMS REQUIRING RESTOCK:
${criticalList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Login to InvenTrack dashboard to take action.`
      }));

      log("WARN", "SNS critical stock summary sent", {
        requestId:     context.awsRequestId,
        criticalCount: criticalItems.length
      });
    }

    // ── Step 6: Return full analytics result ──
    const analyticsResult = {
      snapshotId:    `SNAPSHOT-${hourKey}`,
      timestamp,
      totalProducts,
      totalUnits,
      avgStock,
      healthScore,
      lowStockCount: lowStockItems.length,
      criticalCount: criticalItems.length,
      healthyCount:  healthyItems.length,
      categoryBreakdown: categoryMap,
      fastMovers,
      slowMovers
    };

    log("INFO", "Analytics aggregator completed successfully", {
      requestId:  context.awsRequestId,
      snapshotId: `SNAPSHOT-${hourKey}`
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*"
      },
      body: JSON.stringify({
        message:   "Analytics aggregated successfully",
        analytics: analyticsResult
      })
    };

  } catch (error) {

    log("ERROR", "Analytics aggregator failed", {
      requestId: context.awsRequestId,
      error:     error.message,
      stack:     error.stack
    });

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        message: "Analytics aggregation failed",
        error:   error.message
      })
    };
  }
};
