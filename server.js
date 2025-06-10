const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.set('trust proxy', 1);

let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000,
        httpOnly: true,
    }
};
if (process.env.NODE_ENV === 'production') {
    sessionConfig.cookie.secure = true;
    sessionConfig.cookie.sameSite = 'lax';
} else {
    sessionConfig.cookie.secure = false;
    sessionConfig.cookie.sameSite = 'lax';
}
app.use(session(sessionConfig));

// Google Sheets setup
let auth;
try {
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        let credentials;
        try {
            credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            // Ensure URLs are well-formed (though googleapis library usually handles this)
            if (credentials.auth_uri && !credentials.auth_uri.startsWith('https://')) credentials.auth_uri = 'https://' + credentials.auth_uri.substring(credentials.auth_uri.indexOf('//') + 2);
            if (credentials.token_uri && !credentials.token_uri.startsWith('https://')) credentials.token_uri = 'https://' + credentials.token_uri.substring(credentials.token_uri.indexOf('//') + 2);
            // ... etc. for other URLs if strictly needed, but often not required.
        } catch (parseError) {
            console.error('Error parsing GOOGLE_CREDENTIALS_JSON:', parseError);
            throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
        }
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else if (fs.existsSync('credentials.json')) {
        auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else {
        throw new Error('No Google credentials found. Please set GOOGLE_CREDENTIALS_JSON environment variable or provide credentials.json file.');
    }
    auth.getClient().then(() => {
        console.log('Google Sheets authentication successful');
    }).catch(err => {
        console.error('Google Sheets authentication failed:', err);
    });
} catch (error) {
    console.error('Error setting up Google Auth:', error);
    process.exit(1);
}

const SHEET_NAME = 'Leave Data'; // For user accounts, emails, manager mapping
const LEAVE_APPLICATION_SHEET = 'Leave Application'; // For leave requests
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1YPp78gjT9T_aLXau6FUVc0AxEftHnOijBDjrb3qV4rc';

async function initializeSheet() {
    try {
        const sheetsInstance = google.sheets({ version: 'v4', auth });
        // ... (your existing initializeSheet logic - seems okay for user data sheet)
        // Consider adding header initialization for LEAVE_APPLICATION_SHEET if it doesn't exist
        const appSheetCheck = await sheetsInstance.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A1:G1`
        });
        if (!appSheetCheck.data.values || appSheetCheck.data.values.length === 0) {
            console.log(`Adding headers to the ${LEAVE_APPLICATION_SHEET} sheet...`);
            await sheetsInstance.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${LEAVE_APPLICATION_SHEET}!A1:G1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['ID', 'Username', 'Leave Type', 'Start Date', 'End Date', 'Reason', 'Status']]
                }
            });
            console.log(`${LEAVE_APPLICATION_SHEET} sheet initialized with headers.`);
        }

    } catch (error) {
        console.error('Error initializing sheet:', error);
        // Don't throw here, let the app start, but log the error.
        // throw error; 
    }
}
initializeSheet().then(() => {
    console.log(`Sheets initialized (or verified).`);
}).catch(err => {
    console.error('Failed to initialize sheets:', err);
});

// Middleware to check if user is logged in
function requireLogin(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        // For API endpoints, return JSON. For page loads, you might redirect.
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(401).json({ success: false, message: 'Not authenticated. Please login.' });
        } else {
            // res.redirect('/'); // Or send a login page
            return res.status(401).send('Not authenticated. Please login.');
        }
    }
}

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: 'gmail', // or your email provider
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Static login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/dashboard', (req, res) => { // Assuming you have a dashboard.html
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});


// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:B`, // Assuming Username in A, Password in B
        });
        const rows = response.data.values;
        if (!rows) {
             return res.status(401).json({ success: false, message: 'Invalid credentials or sheet error.' });
        }
        // Find user, skip header row if present (e.g., if rows[0] is ['Username', 'Password'])
        const userRow = rows.find((row, index) => index > 0 && row[0] === username); // Basic find, assuming bcrypt comparison happens next

        if (userRow) {
            // Assuming password in sheet is hashed. If plain text, direct compare: userRow[1] === password
            // For bcrypt:
            // const match = await bcrypt.compare(password, userRow[1]);
            // For now, using plain text as per your original code:
            if (userRow[1] === password) { // Placeholder for bcrypt.compare if passwords are hashed
                 const userIndex = rows.findIndex(row => row[0] === username); // Get the actual index for rowIndex
                 req.session.user = { username, rowIndex: userIndex + 1 }; // rowIndex is 1-based
                 req.session.save(err => {
                    if (err) {
                        console.error('Session save error:', err);
                        return res.status(500).json({ success: false, message: 'Session error during login.' });
                    }
                    res.json({ success: true, message: 'Login successful' });
                });
            } else {
                res.status(401).json({ success: false, message: 'Invalid credentials.' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
    } catch (error) {
        console.error('Login server error:', error);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// Get user leave data (dashboard)
app.get('/api/leave-data', requireLogin, async (req, res) => {
    try {
        // ... (Your existing /api/leave-data logic seems fine for fetching user-specific data)
        // Make sure LEAVE_APPLICATION_SHEET has headers: ID, Username, Leave Type, Start Date, End Date, Reason, Status
        const leaveApplicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`, // Fetch all columns
        });
        
        let allApplications = [];
        if (leaveApplicationsResponse.data.values) {
            const headerRow = leaveApplicationsResponse.data.values[0]; // Assuming first row is header
            allApplications = leaveApplicationsResponse.data.values.slice(1) // Skip header
                .filter(row => row[1] === req.session.user.username) // Filter by username (column B)
                .map(app => ({
                    id: app[0],          // Column A
                    username: app[1],    // Column B
                    leaveType: app[2],   // Column C
                    startDate: app[3],   // Column D
                    endDate: app[4],     // Column E
                    reason: app[5] || 'No reason provided',      // Column F
                    status: app[6]       // Column G
                }));
        }
         const userDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${req.session.user.rowIndex}:AH${req.session.user.rowIndex}`,
        });
        const userData = userDataResponse.data.values[0];
        // ... rest of your user data processing logic ...
         res.json({
            success: true,
            data: {
                username: userData[0],
                // ... (your existing data structure)
                applications: allApplications // Use the correctly mapped and filtered applications
            }
        });

    } catch (error) {
        console.error('Error fetching leave data:', error);
        res.status(500).json({ success: false, message: 'Server error fetching leave data.' });
    }
});

// Apply leave endpoint
app.post('/api/apply-leave', requireLogin, async (req, res) => {
    const { leaveType, startDate, endDate, reason, days } = req.body; // 'days' might be calculated or passed
    const username = req.session.user.username;
    const userRowIndexInLeaveDataSheet = req.session.user.rowIndex; // For updating user's leave balance

    // Basic validation
    if (!leaveType || !startDate || !endDate || !days) {
        return res.status(400).json({ success: false, message: 'Missing required fields for leave application.' });
    }
    // Add more validation for dates, days, etc. if needed

    // Weekends check (example, adjust as needed)
    const startDay = new Date(startDate).getUTCDay(); // Use UTC for consistency if dates are UTC
    const endDay = new Date(endDate).getUTCDay();
    if (startDay === 0 || startDay === 6 || endDay === 0 || endDay === 6) {
        // This depends on company policy, some leaves might span weekends but only count workdays
        // return res.status(400).json({ success: false, message: 'Leave applications cannot start or end on weekends.' });
    }

    try {
        // 1. Get the next available ID for LEAVE_APPLICATION_SHEET
        const idResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:A`, // Get all IDs from Column A
        });
        let nextId = 1;
        if (idResponse.data.values && idResponse.data.values.length > 0) {
            const ids = idResponse.data.values
                .slice(1) // Skip header row if there is one
                .map(row => parseInt(row[0]))
                .filter(id => !isNaN(id));
            if (ids.length > 0) {
                nextId = Math.max(0, ...ids) + 1; // Ensure Math.max doesn't get -Infinity if ids is empty after filter
            } else {
                 // If only header or no numeric IDs, start from 1
                nextId = 1;
            }
        }
        // If sheet was completely empty (no header, no data), nextId remains 1.

        const leaveApplicationRowData = [
            nextId.toString(),
            username,
            leaveType,
            startDate, // Ensure format is consistent with sheet
            endDate,   // Ensure format is consistent with sheet
            reason || 'No reason provided',
            'Pending'  // Initial status
        ];

        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`, // Append to columns A through G
            valueInputOption: 'USER_ENTERED', // Or 'RAW' if you don't need Sheets to parse dates etc.
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [leaveApplicationRowData] }
        });
        
        const updatedSheetRange = appendResponse.data.updates.updatedRange;
        const newApplicationRowNumberInSheet = parseInt(updatedSheetRange.substring(updatedSheetRange.indexOf('A') + 1, updatedSheetRange.indexOf(':')));


        // 2. Update user's leave balance on the 'Leave Data' sheet (your existing logic)
        // Ensure 'days' is a valid number
        const numDays = parseInt(days);
        if (isNaN(numDays) || numDays <= 0) {
             // Potentially reverse the application append or handle error
            console.error("Invalid number of days for leave application:", days);
            // return res.status(400).json({ success: false, message: 'Invalid number of days.' });
        } else {
            // Your logic to update AG (leaveTaken) and AH (leaveBalance) columns
            // This needs to fetch current values, calculate, then update.
            // Example:
            // const leaveBalanceData = await sheets.spreadsheets.values.get({ ... range: `${SHEET_NAME}!AG${userRowIndexInLeaveDataSheet}:AH${userRowIndexInLeaveDataSheet}`});
            // let currentTaken = parseInt(leaveBalanceData.data.values[0][0]) || 0;
            // let currentBalance = parseInt(leaveBalanceData.data.values[0][1]) || 0;
            // await sheets.spreadsheets.values.update({ ..., requestBody: { values: [[currentTaken + numDays, currentBalance - numDays]]}});
            console.log(`Leave balance update for row ${userRowIndexInLeaveDataSheet} should happen here.`);
        }


        // 3. Send email to manager
        const managerEmail = await getManagerEmail(username); // Assumes this function is defined
        const applicantEmail = await getApplicantEmail(username); // Assumes this function is defined

        if (managerEmail) {
            const mailOptionsToManager = {
                from: process.env.EMAIL_USER,
                to: managerEmail,
                subject: `New Leave Application for Approval - ${username} (ID: ${nextId})`,
                html: `
                    <p>A new leave application has been submitted by ${username} (Application ID: ${nextId}).</p>
                    <p><strong>Leave Type:</strong> ${leaveType}</p>
                    <p><strong>Start Date:</strong> ${startDate}</p>
                    <p><strong>End Date:</strong> ${endDate}</p>
                    <p><strong>Days:</strong> ${days}</p>
                    <p><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
                    <hr>
                    <p>To approve or reject this application, please use the system dashboard.</p>
                    <p><em>(Approval Link Placeholder: ${req.protocol}://${req.get('host')}/api/approve-leave?row=${newApplicationRowNumberInSheet})</em></p>
                    <p><em>(Rejection Link Placeholder: ${req.protocol}://${req.get('host')}/api/reject-leave?row=${newApplicationRowNumberInSheet})</em></p>
                    <p>Application Row in Sheet (for admin reference): ${newApplicationRowNumberInSheet}</p>
                    <p>This is an automated notification.</p>
                `
            };
            try {
                await transporter.sendMail(mailOptionsToManager);
                console.log(`Email sent to manager ${managerEmail} for application ID ${nextId}`);
            } catch (err) {
                console.error('Error sending email to manager:', err);
            }
        } else {
            console.warn(`Manager email not found for user ${username}. Cannot send approval request email.`);
        }

        res.json({ success: true, message: 'Leave application submitted successfully.', applicationId: nextId.toString(), applicationRow: newApplicationRowNumberInSheet });

    } catch (error) {
        console.error('Server error in /api/apply-leave:', error);
        res.status(500).json({ success: false, message: 'Server error while submitting leave application.' });
    }
});

// Approve Leave Endpoint
app.get('/api/approve-leave', async (req, res) => { // Consider making this a POST/PUT if it changes state
    const { row: applicationRow } = req.query; // applicationRow is the row number in LEAVE_APPLICATION_SHEET

    if (!applicationRow || isNaN(parseInt(applicationRow))) {
        return res.status(400).send('A valid application row number is required via "row" query parameter.');
    }
    try {
        const appDetailsRange = `${LEAVE_APPLICATION_SHEET}!A${applicationRow}:G${applicationRow}`;
        const appDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: appDetailsRange,
        });

        if (!appDetailsResponse.data.values || appDetailsResponse.data.values.length === 0) {
            return res.status(404).send(`Application not found at row ${applicationRow}.`);
        }
        const appDetails = appDetailsResponse.data.values[0];
        const [applicationID, username, leaveType, startDate, endDate, reasonText, currentStatus] = appDetails;

        if (currentStatus === 'Approved') {
            return res.send(`Application ID ${applicationID} (Row ${applicationRow}) is already approved.`);
        }
        if (currentStatus === 'Rejected') {
             return res.send(`Application ID ${applicationID} (Row ${applicationRow}) was previously rejected. Please re-evaluate if needed.`);
        }


        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`, // Update Status in Column G
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Approved']] }
        });

        const applicantEmail = await getApplicantEmail(username);
        if (applicantEmail) {
            const mailOptionsToApplicant = {
                from: process.env.EMAIL_USER,
                to: applicantEmail,
                subject: `Leave Application Approved (ID: ${applicationID})`,
                html: `<p>Your leave application (ID: ${applicationID}) has been approved.</p>
                    <p><strong>Leave Type:</strong> ${leaveType}</p>
                    <p><strong>Start Date:</strong> ${startDate}</p>
                    <p><strong>End Date:</strong> ${endDate}</p>
                    <p><strong>Reason:</strong> ${reasonText || 'No reason provided'}</p>
                    <p>This is an automated notification.</p>`
            };
            try {
                await transporter.sendMail(mailOptionsToApplicant);
                console.log(`Approval Email sent to applicant ${applicantEmail} for application ID ${applicationID}`);
            } catch (err) {
                console.error(`Error sending approval email to ${applicantEmail} for ID ${applicationID}:`, err);
            }
        } else {
            console.warn(`Applicant email not found for ${username} (Application ID ${applicationID}). Cannot send approval notification email.`);
        }
        res.send(`Leave application ID ${applicationID} (Row ${applicationRow}) has been approved successfully. Applicant notified if email was found.`);
    } catch (error) {
        console.error(`Error in /api/approve-leave for row ${applicationRow}:`, error);
        res.status(500).send(`Error approving leave. Details: ${error.message}`);
    }
});

// Reject Leave Endpoint
app.get('/api/reject-leave', async (req, res) => { // Consider making this a POST/PUT
    const { row: applicationRow } = req.query;

    if (!applicationRow || isNaN(parseInt(applicationRow))) {
        return res.status(400).send('A valid application row number is required via "row" query parameter.');
    }
    try {
        const appDetailsRange = `${LEAVE_APPLICATION_SHEET}!A${applicationRow}:G${applicationRow}`;
        const appDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: appDetailsRange,
        });

        if (!appDetailsResponse.data.values || appDetailsResponse.data.values.length === 0) {
            return res.status(404).send(`Application not found at row ${applicationRow}.`);
        }
        const appDetails = appDetailsResponse.data.values[0];
        const [applicationID, username, leaveType, startDate, endDate, reasonText, currentStatus] = appDetails;

        if (currentStatus === 'Rejected') {
            return res.send(`Application ID ${applicationID} (Row ${applicationRow}) is already rejected.`);
        }
         if (currentStatus === 'Approved') {
             // If already approved, and now rejecting, you might need to adjust leave balances back.
             // This logic is not included here but is an important consideration.
             console.warn(`Application ID ${applicationID} (Row ${applicationRow}) was previously approved and is now being rejected. Ensure leave balances are adjusted if necessary.`);
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`, // Update Status in Column G
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Rejected']] }
        });

        // If rejecting an approved application, you should revert the leave days taken.
        // This logic needs to be added if applicable.

        const applicantEmail = await getApplicantEmail(username);
        if (applicantEmail) {
            const mailOptionsToApplicant = {
                from: process.env.EMAIL_USER,
                to: applicantEmail,
                subject: `Leave Application Rejected (ID: ${applicationID})`,
                html: `<p>Your leave application (ID: ${applicationID}) has been rejected.</p>
                    <p><strong>Leave Type:</strong> ${leaveType}</p>
                    <p><strong>Start Date:</strong> ${startDate}</p>
                    <p><strong>End Date:</strong> ${endDate}</p>
                    <p><strong>Reason:</strong> ${reasonText || 'No reason provided'}</p>
                    <p>This is an automated notification.</p>`
            };
            try {
                await transporter.sendMail(mailOptionsToApplicant);
                console.log(`Rejection Email sent to applicant ${applicantEmail} for application ID ${applicationID}`);
            } catch (err) {
                console.error(`Error sending rejection email to ${applicantEmail} for ID ${applicationID}:`, err);
            }
        } else {
            console.warn(`Applicant email not found for ${username} (Application ID ${applicationID}). Cannot send rejection notification email.`);
        }
        res.send(`Leave application ID ${applicationID} (Row ${applicationRow}) has been rejected. Applicant notified if email was found.`);
    } catch (error) {
        console.error(`Error in /api/reject-leave for row ${applicationRow}:`, error);
        res.status(500).send(`Error rejecting leave. Details: ${error.message}`);
    }
});


// Function to get applicant's email from Leave Data sheet (SHEET_NAME)
// Assumes: Column A is Username, Column C is Email
async function getApplicantEmail(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:C`, // Check columns A (Username) and C (Email)
        });
        const rows = response.data.values;
        if (!rows) return null;
        // Skip header if present (e.g. rows[0][0] === 'Username')
        const dataRows = rows[0][0] === 'Username' ? rows.slice(1) : rows;
        const userRow = dataRows.find(row => row[0] === username);
        return userRow && userRow[2] ? userRow[2] : null; // Email is in the 3rd column (index 2)
    } catch (error) {
        console.error(`Error fetching applicant email for ${username}:`, error);
        return null;
    }
}

// Function to get manager's email from Leave Data sheet (SHEET_NAME)
// Assumes: Col A Username, Col C Email, Col D Manager's Username
async function getManagerEmail(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:D`, // Username, (skip B), Email, ManagerUsername
        });
        const rows = response.data.values;
        if (!rows) return null;

        const dataRows = rows[0][0] === 'Username' ? rows.slice(1) : rows; // Skip header
        const userRow = dataRows.find(row => row[0] === username);

        if (!userRow || !userRow[3]) { // userRow[3] is Manager's Username (Col D)
            console.log(`No manager username found for ${username}`);
            return null;
        }
        const managerUsername = userRow[3];
        const managerRow = dataRows.find(row => row[0] === managerUsername); // Find manager in the same list

        return managerRow && managerRow[2] ? managerRow[2] : null; // Manager's email from their Col C
    } catch (error) {
        console.error(`Error fetching manager email for user ${username}:`, error);
        return null;
    }
}

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, message: 'Logout error' });
        }
        res.clearCookie('connect.sid'); // Default session cookie name, adjust if different
        res.json({ success: true, message: 'Logout successful' });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
