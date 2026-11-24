# Bookstoriaga — Inventory & POS System

A static front-end prototype for a manga, comic, and bookshop Inventory & Point-of-Sale (POS) Management System, structured cleanly for GitHub and static cloud hosting (such as **AWS Amplify** or **Amazon S3 + CloudFront**).

## Project Structure

```text
bookstoriaga/
├── index.html          # Application markup & views
├── styles.css          # Mocha/Espresso CSS variables, responsive layout & components
├── app.js              # Simulated ApiService (localStorage) & UI controller
├── assets/
│   └── icons/          # Sidebar & header icon PNGs (add your local icon files here)
└── README.md
```

## Notes on Assets & Backend Integration

- **Icons (`assets/icons/`):** Ensure your custom PNG icons (`Dashboard.png`, `Inventory Management.png`, `Supplier Management.png`, `User Management.png`, `Audit Log.png`, `Settings.png`, `Book Mode.png`, `Light Mode.png`, `Dark Mode.png`, `Collapse.png`, `Log Out.png`, `Notifications.png`) are placed in `assets/icons/` when pushing to GitHub.
- **Book covers:** When running the PHP API, uploaded JPG, PNG, and WebP covers are stored in `uploads/book-covers/`. The folder is created automatically on the first upload; PHP's upload limit must allow files up to 5 MB.
- **Backend API Migration:** All data persistence is isolated inside `ApiService` at the top of `app.js`. Each asynchronous method (`login`, `getInventory`, `submitTransaction`, `manageUsers`, `getLogs`) can be replaced with `fetch()` calls to an AWS API Gateway / Lambda or Node/Express backend without changing UI rendering logic.

## Deploying to AWS

1. **AWS Amplify (Recommended for GitHub):**
   - Push this folder to a GitHub repository.
   - Open **AWS Amplify Console** → **Create new app** → Connect your GitHub repository and branch.
   - Leave build commands empty (pure static HTML/CSS/JS) and deploy.
2. **Amazon S3 Static Website Hosting:**
   - Upload `index.html`, `styles.css`, `app.js`, and `assets/` to an S3 bucket with Static Website Hosting enabled (or serve via CloudFront).
