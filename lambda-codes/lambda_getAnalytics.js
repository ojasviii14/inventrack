import { DynamoDBClient, ScanCommand, QueryCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "ap-south-1" });

// ── Structured JSON Logger ──
const log = (level, message, meta = {}) => {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "getAnalytics",
    ...meta
  }));
};

export const handler = async (event, context) => {

  log("INFO", "Get analytics request received", {
    requestId: context.awsRequestId
  });

  try {

    // ── Step 1: Scan AnalyticsTable for all snapshots ──
    const t0 = Date.now();
    const result = await client.send(new ScanCommand({
      TableName: "AnalyticsTable",
      Limit: 50 // last 50 hourly snapshots = ~2 days
    }));
    const latency = Date.now() - t0;

    if (!result.Items || result.Items.length === 0) {
      log("WARN", "No analytics snapshots found in AnalyticsTable", {
        requestId: context.awsRequestId
      });
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*"
        },
        body: JSON.stringify({
          message: "No analytics data yet",
          snapshots: [],
          latest: null
        })
      };
    }

    // ── Step 2: Parse all snapshots ──
    const snapshots = result.Items.map(item => ({
      snapshotId:    item.snapshotId?.S || "",
      timestamp:     item.timestamp?.S || "",
      dateKey:       item.dateKey?.S || "",
      hourKey:       item.hourKey?.S || "",
      totalProducts: Number(item.totalProducts?.N || 0),
      totalUnits:    Number(item.totalUnits?.N || 0),
      lowStockCount: Number(item.lowStockCount?.N || 0),
      criticalCount: Number(item.criticalCount?.N || 0),
      healthyCount:  Number(item.healthyCount?.N || 0),
      healthScore:   Number(item.healthScore?.N || 0),
      avgStock:      Number(item.avgStock?.N || 0),
      categoryBreakdown: item.categoryBreakdown?.S
        ? JSON.parse(item.categoryBreakdown.S)
        : {},
      fastMovers: item.fastMovers?.S
        ? JSON.parse(item.fastMovers.S)
        : [],
      slowMovers: item.slowMovers?.S
        ? JSON.parse(item.slowMovers.S)
        : []
    }));

    // ── Step 3: Sort by timestamp descending ──
    snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const latest = snapshots[0];

    // ── Step 4: Build trend data (last 24 snapshots = last 24 hours) ──
    const trend = snapshots.slice(0, 24).reverse().map(s => ({
      time:          s.hourKey,
      totalProducts: s.totalProducts,
      totalUnits:    s.totalUnits,
      lowStockCount: s.lowStockCount,
      healthScore:   s.healthScore
    }));

    log("INFO", "Analytics data fetched successfully", {
      requestId:      context.awsRequestId,
      snapshotCount:  snapshots.length,
      latestSnapshot: latest.snapshotId,
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
        message:       "Analytics fetched successfully",
        latest,
        snapshots:     snapshots.slice(0, 24),
        trend,
        generatedAt:   new Date().toISOString()
      })
    };

  } catch (error) {

    log("ERROR", "Failed to fetch analytics", {
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
        message: "Error fetching analytics",
        error:   error.message
      })
    };
  }
};
