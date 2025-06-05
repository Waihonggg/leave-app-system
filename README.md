# Leave Application System

A web-based leave application system with Google Sheets integration.

## Features

- User authentication
- Leave balance tracking
- Apply for different types of leave (Annual Leave, Compassionate Leave, Medical Certificate)
- Monthly leave usage tracking
- Real-time Google Sheets integration
- Responsive design

## Setup Instructions

### Prerequisites

1. Node.js (v14 or higher)
2. Google Cloud account
3. GitHub account
4. Render account

### Local Setup

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/leave-application-system.git
cd leave-application-system
```

2. Install dependencies:
```bash
npm install
```

3. Set up Google Sheets API:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project
   - Enable Google Sheets API
   - Create service account credentials
   - Download the JSON key file and save as `credentials.json`

4. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Update the values in `.env`

5. Share your Google Sheet with the service account email

6. Run the application:
```bash
npm start
```

### Deployment to Render

1. Push your code to GitHub

2. Go to [Render Dashboard](https://dashboard.render.com/)

3. Create a new Web Service

4. Connect your GitHub repository

5. Configure the service:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`

6. Add environment variables in Render:
   - `GOOGLE_APPLICATION_CREDENTIALS`: Upload your credentials.json content
   - `SPREADSHEET_ID`: Your Google Sheet ID
   - `SESSION_SECRET`: A random secret key
   - `PORT`: Leave empty (Render will assign)

7. Deploy!

## Usage

1. Login with your username and password
2. View your leave balance on the dashboard
3. Apply for leave by selecting dates and leave type
4. Your Google Sheet will be automatically updated

## Leave Types

- **Annual Leave (AL)**: Regular vacation days
- **Compassionate/Care Leave (CCL)**: For family emergencies
- **Medical Certificate (MC)**: Sick leave with medical certificate

## Leave Logic

- Total leave = Carry forward from previous year + Current year allocation + CCL
- Leave balance = Total leave - Leave taken
- MC is tracked separately with its own balance
- Leave is deducted from the month when it starts

## Support

For issues or questions, please create an issue in the GitHub repository.
