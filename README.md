\# InvenTrack — Cloud-Based Inventory Management System



> A fully serverless, cloud-native inventory management system built on AWS for small and medium businesses. Developed as part of an 8th semester internship at \*\*F13 Technologies, New Delhi\*\*.



\---



\## 🏗 Architecture Overview



```

Browser (S3 Static Hosting)

&#x20;       │

&#x20;       ▼

Amazon Cognito (Auth + RBAC)

&#x20;       │

&#x20;       ▼

Amazon API Gateway (REST API)

&#x20;       │

&#x20;       ▼

AWS Lambda Functions (Serverless Compute)

&#x20;  ├── addProduct

&#x20;  ├── getProducts

&#x20;  ├── updateProduct

&#x20;  ├── deleteProduct

&#x20;  ├── getLowStockProducts

&#x20;  └── analyticsAggregator ◄── EventBridge (every 1 hour)

&#x20;       │

&#x20;       ├──► Amazon DynamoDB

&#x20;       │     ├── Products Table

&#x20;       │     ├── TransactionsTable

&#x20;       │     └── AnalyticsTable

&#x20;       │

&#x20;       ├──► Amazon SNS (Email Alerts)

&#x20;       │

&#x20;       └──► Amazon CloudWatch (Logs + Alarms)

```



\---



\## ✨ Features



\### Core Inventory

\- Add, update, delete, and retrieve products in real time

\- Per-product configurable stock thresholds

\- Automatic low-stock email alerts via Amazon SNS

\- PDF inventory report export



\### Role-Based Access Control

\- \*\*Administrator\*\* — full access (add, update, delete, analytics, cost tracker, IAM view)

\- \*\*Staff / Operator\*\* — read + update only (no delete, no admin pages)

\- Powered by Amazon Cognito User Pool Groups



\### AI Forecast (EOQ Model)

\- Predicts days until stockout based on stock velocity

\- Economic Order Quantity (EOQ) formula for reorder recommendations

\- Urgency classification: Urgent / Soon / Monitor / Stable



\### Analytics

\- Stock distribution bar chart and category doughnut chart

\- 7-day activity heatmap by category

\- Fast mover vs slow mover classification

\- Stock health overview with progress bars



\### Transaction History

\- Every stock change logged as STOCK\_IN / STOCK\_OUT / ADD / DELETE

\- Unique TXN-IDs per transaction

\- 7-day volume chart and action breakdown doughnut



\### Audit Trail

\- Tamper-evident log of all user actions

\- Records action type, Cognito user identity, and timestamp

\- Filterable by action type



\### Monitoring \& Observability

\- Structured JSON logging across all Lambda functions with requestId correlation

\- API latency timeline chart (last 10 calls)

\- Success vs error rate doughnut chart

\- Filterable activity log by level (INFO / WARN / ERROR / SUCCESS)




\### CloudWatch Alarms (3 configured)

| Alarm | Threshold | Action |

|-------|-----------|--------|

| LambdaErrorAlarm | Errors > 3 in 5 min | SNS email |

| APILatencyAlarm | Latency > 3000ms | SNS email |

| LambdaDurationAlarm | Duration > 5000ms | SNS email |




\### Cost Tracker

\- Real-time AWS Free Tier usage estimation per service

\- 6 AWS cost optimization tips

\- Free Tier status table for all 6 services



\---



\## 🛠 Tech Stack



| Layer | Technology |

|-------|------------|

| Frontend | HTML, CSS, JavaScript, Chart.js |

| Auth | Amazon Cognito (User Pools + Groups) |

| API | Amazon API Gateway (REST) |

| Compute | AWS Lambda (Node.js 18.x) |

| Database | Amazon DynamoDB (3 tables) |

| Notifications | Amazon SNS |

| Monitoring | Amazon CloudWatch Logs + Alarms |

| Scheduling | Amazon EventBridge Scheduler |

| Hosting | Amazon S3 Static Website |

| IaC | AWS SAM (template.yaml) |



\---



\## 📁 Project Structure



```

inventrack/

├── template.yaml                  # AWS SAM — Infrastructure as Code

├── frontend/

│   └── index.html                 # Full dashboard (single-page app)

├── lambdas/

│   ├── addProduct/

│   │   └── addProduct.js

│   ├── getProducts/

│   │   └── getProducts.js

│   ├── updateProduct/

│   │   └── updateProduct.js

│   ├── deleteProduct/

│   │   └── deleteProduct.js

│   ├── getLowStockProducts/

│   │   └── getLowStockProducts.js

│   └── analyticsAggregator/

│       └── analyticsAggregator.js

└── README.md





\---



\## 🗄 DynamoDB Schema



\### Products Table

| Attribute | Type | Key |

|-----------|------|-----|

| productId | String | Partition Key |

| productName | String | — |

| category | String | — |

| currentStock | Number | — |

| thresholdLevel | Number | — |

| createdAt | String (ISO) | — |



\### TransactionsTable

| Attribute | Type | Key |

|-----------|------|-----|

| productId | String | Partition Key |

| timestamp | String (ISO) | Sort Key |

| txnId | String | — |

| action | String (STOCK\_IN / STOCK\_OUT / ADD / DELETE) | — |

| previousStock | Number | — |

| newStock | Number | — |

| quantity | Number | — |

| performedBy | String | — |



\### AnalyticsTable

| Attribute | Type | Key |

|-----------|------|-----|

| snapshotId | String | Partition Key |

| timestamp | String (ISO) | Sort Key |

| totalProducts | Number | — |

| lowStockCount | Number | — |

| criticalCount | Number | — |

| healthScore | Number | — |

| fastMovers | String (JSON) | — |

| slowMovers | String (JSON) | — |



\---



\## 🔌 API Endpoints



| Method | Endpoint | Lambda | Description |

|--------|----------|--------|-------------|

| GET | /product/products | getProducts | Fetch all products |

| POST | /product | addProduct | Add new product |

| PUT | /product | updateProduct | Update stock level |

| DELETE | /product | deleteProduct | Delete product |

| GET | /product/low-stock | getLowStockProducts | Get low stock items |



\---



\## 🚀 Deployment



\### Prerequisites

\- AWS CLI configured (`aws configure`)

\- AWS SAM CLI installed (`pip install aws-sam-cli`)

\- Node.js 18+



\### Deploy with SAM

```bash

\# Clone the repo

git clone https://github.com/yourusername/inventrack.git

cd inventrack



\# Build and deploy

sam build

sam deploy --guided





\### Deploy frontend to S3

```bash

aws s3 cp frontend/index.html s3://your-bucket-name/index.html





\---



\## 📊 CloudWatch Logs Insights Queries



\*\*View all errors across all Lambdas:\*\*



fields @timestamp, message, service, requestId

| filter level = "ERROR"

| sort @timestamp desc

| limit 20





\*\*View low stock warnings:\*\*



fields @timestamp, message, productName, currentStock, thresholdLevel

| filter level = "WARN"

| sort @timestamp desc





\*\*API latency analysis:\*\*



fields @timestamp, service, dynamoLatencyMs

| filter ispresent(dynamoLatencyMs)

| stats avg(dynamoLatencyMs) as avgLatency by service



\---



\## 👩‍💻 Author



\*\*Ojasvi Mohapatra\*\*

Reg. No. 220911042

B.Tech — School of Computer Engineering

Manipal Institute of Technology, Manipal



\*\*Internship Mentor:\*\* Mr. Kabir Yadav, F13 Technologies, New Delhi



\*\*Academic Guide:\*\* Dr. Vidya Kamath, Assistant Professor, MIT Manipal



\---



\## 📄 License



This project was developed as part of an academic internship. All rights reserved.


