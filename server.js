const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
const bcrypt = require('bcryptjs'); // Make sure to use bcrypt for password hashing in a real app
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true, // Or specify your frontend URL for production
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // Serves static files from the root
app.set('trust proxy', 1); // Important for Render/proxies if using secure cookies

let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-very-secret-key-for-sessions',
    resave: false,
    saveUninitialized: false, // Changed to false for GDPR, set true if you want sessions for all
    cookie: {
        maxAge: 3600000, // 1 hour
        httpOnly: true, // Helps prevent XSS
        // secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        // sameSite: 'lax' // Or 'strict' or 'none' (if 'none', secure must be true)
    }
};

// In production (like on Render), secure cookies should be enabled
if (process.env.NODE_ENV === 'production') {
    sessionConfig.cookie.secure = true;
    sessionConfig.cookie.sameSite = 'lax'; // Or 'none' if cross-site, but ensure frontend/backend on same-site if possible
}

app.use(session(sessionConfig));

// Google Sheets setup
let auth;
try {
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
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
        throw new Error('No Google credentials found.');
    }
    auth.getClient().then(() => {
        console.log('Google Sheets authentication successful');
    }).catch(err => {
        console.error('Google Sheets authentication failed:', err.message);
    });
} catch (error) {
    console.error('Error setting up Google Auth:', error.message);
    process.exit(1);
}

const SHEET_NAME = 'Leave Data';
const LEAVE_APPLICATION_SHEET = 'Leave Application';
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

if (!SPREADSHEET_ID) {
    console.error("SPREADSHEET_ID environment variable is not set.");
    process.exit(1);
}


async function initializeSheetHeaders() {
    try {
        const sheetsInstance = google.sheets({ version: 'v4', auth });
        // Check/initialize 'Leave Data' sheet
        const userSheetCheck = await sheetsInstance.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:D1` // Check for Username, Password, Email, Manager Username
        });
        if (!userSheetCheck.data.values || userSheetCheck.data.values.length === 0 || userSheetCheck.data.values[0].length < 4) {
            console.log(`Adding headers to the ${SHEET_NAME} sheet...`);
            await sheetsInstance.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['Username', 'Password', 'Email', 'Manager Username', 'Carry Forward', 'Annual Leave Entitlement', 'Compassionate Leave Entitlement', 'Total Leave Entitlement (Calculated or Fixed)', 'Jan Leave', 'Jan MC', 'Feb Leave', 'Feb MC', 'Mar Leave', 'Mar MC', 'Apr Leave', 'Apr MC', 'May Leave', 'May MC', 'Jun Leave', 'Jun MC', 'Jul Leave', 'Jul MC', 'Aug Leave', 'Aug MC', 'Sep Leave', 'Sep MC', 'Oct Leave', 'Oct MC', 'Nov Leave', 'Nov MC', 'Dec Leave', 'Dec MC', 'Total Leave Taken', 'Leave Balance', 'Total MC Taken', 'MC Balance']]
                    // Adjusted header to match common userData indices used
                }
            });
        }

        // Check/initialize 'Leave Application' sheet
        const appSheetCheck = await sheetsInstance.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A1:G1`
        });
        if (!appSheetCheck.data.values || appSheetCheck.data.values.length === 0 || appSheetCheck.data.values[0].length < 7) {
            console.log(`Adding headers to the ${LEAVE_APPLICATION_SHEET} sheet...`);
            await sheetsInstance.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${LEAVE_APPLICATION_SHEET}!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['ID', 'Username', 'Leave Type', 'Start Date', 'End Date', 'Reason', 'Status']]
                }
            });
        }
        console.log('Sheet headers verified/initialized.');
    } catch (error) {
        console.error('Error initializing sheet headers:', error.message);
    }
}

initializeSheetHeaders();

// Middleware to check if user is logged in
function requireLogin(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
            return res.status(401).json({ success: false, message: 'Not authenticated. Please login.' });
        } else {
            return res.redirect('/'); // Redirect to login page for non-AJAX requests
        }
    }
}

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Static pages
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/dashboard.html'); // Or your main dashboard page
    } else {
        res.sendFile(path.join(__dirname, 'login.html'));
    }
});

app.get('/dashboard.html', requireLogin, (req, res) => {
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
            range: `${SHEET_NAME}!A:B`, // Column A: Username, Column B: Password (Plain text in this example)
        });
        const rows = response.data.values;
        if (!rows) {
             return res.status(401).json({ success: false, message: 'Login failed. User data sheet might be empty or inaccessible.' });
        }
        
        let userFound = null;
        let userIndex = -1;

        // Skip header row (assuming first row is header)
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === username && rows[i][1] === password) { // Plain text password check
                // IMPORTANT: For production, hash passwords. Example:
                // const match = await bcrypt.compare(password, rows[i][1]);
                // if (match) { ... }
                userFound = { username: rows[i][0] };
                userIndex = i; // 0-based index
                break;
            }
        }

        if (userFound) {
            req.session.user = { username: userFound.username, rowIndex: userIndex + 1 }; // rowIndex is 1-based for Sheets
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
    } catch (error) {
        console.error('Login server error:', error);
        res.status(500).json({ success: false, message: 'Server error during login processing.' });
    }
});

// Get user leave data (for dashboard)
app.get('/api/leave-data', requireLogin, async (req, res) => {
    try {
        const userSheetRow = req.session.user.rowIndex; // 1-based index
        const username = req.session.user.username;

        // Fetch user-specific data from 'Leave Data' sheet
        // Columns A-AF correspond to indices 0-31
        // A=0, B=1, ..., H=7, I=8 (Jan Leave), ... AF=31 (Dec MC), AG=32 (Total Taken), AH=33 (Balance)
        const userDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${userSheetRow}:AH${userSheetRow}`, // Fetch up to column AH
        });

        if (!userDataResponse.data.values || userDataResponse.data.values.length === 0) {
            console.error(`No data found for user ${username} at row ${userSheetRow} in ${SHEET_NAME}`);
            return res.status(404).json({ success: false, message: 'User data not found.' });
        }
        const userData = userDataResponse.data.values[0]; // This is an array of cell values for that row

        // Fetch all leave applications for the logged-in user
        const leaveApplicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`, // ID, Username, Type, Start, End, Reason, Status
        });
        
        let userApplications = [];
        if (leaveApplicationsResponse.data.values && leaveApplicationsResponse.data.values.length > 1) { // Assuming header row
            userApplications = leaveApplicationsResponse.data.values.slice(1) // Skip header
                .filter(row => row.length >= 7 && row[1] === username) // Ensure row has enough columns and username matches
                .map(app => ({
                    id: app[0],
                    username: app[1],
                    leaveType: app[2],
                    startDate: app[3],
                    endDate: app[4],
                    reason: app[5] || 'No reason provided',
                    status: app[6]
                }));
        }
        
        // Construct the monthlyData object carefully
        // Indices for monthly data: Jan Leave (8), Jan MC (9), ..., Dec Leave (30), Dec MC (31)
        // Total Leave Entitlement (7), Calculated Total Leave Taken (32), Calculated Leave Balance (33)
        // MC Taken (34), MC Balance (35) - ensure sheet has these columns if using these indices

        const monthlyDataPayload = {
            Jan: { leave: parseInt(userData[8]) || 0, mc: parseInt(userData[9]) || 0 },
            Feb: { leave: parseInt(userData[10]) || 0, mc: parseInt(userData[11]) || 0 },
            March: { leave: parseInt(userData[12]) || 0, mc: parseInt(userData[13]) || 0 },
            Apr: { leave: parseInt(userData[14]) || 0, mc: parseInt(userData[15]) || 0 },
            May: { leave: parseInt(userData[16]) || 0, mc: parseInt(userData[17]) || 0 },
            June: { leave: parseInt(userData[18]) || 0, mc: parseInt(userData[19]) || 0 },
            July: { leave: parseInt(userData[20]) || 0, mc: parseInt(userData[21]) || 0 },
            Aug: { leave: parseInt(userData[22]) || 0, mc: parseInt(userData[23]) || 0 },
            Sept: { leave: parseInt(userData[24]) || 0, mc: parseInt(userData[25]) || 0 },
            Oct: { leave: parseInt(userData[26]) || 0, mc: parseInt(userData[27]) || 0 },
            Nov: { leave: parseInt(userData[28]) || 0, mc: parseInt(userData[29]) || 0 },
            Dec: { leave: parseInt(userData[30]) || 0, mc: parseInt(userData[31]) || 0 }
        };
        
        const totalLeaveEntitlement = parseInt(userData[7]) || 0; // Assuming index 7 is total leave entitlement
        const leaveTaken = parseInt(userData[32]) || 0; // Assuming index 32 is total leave taken
        const leaveBalance = parseInt(userData[33]) || 0; // Assuming index 33 is leave balance

        const responsePayload = {
            success: true,
            data: {
                username: userData[0] || username,
                carryForward: parseInt(userData[4]) || 0,         // Index 4
                annualLeave: parseInt(userData[5]) || 0,          // Index 5
                compassionateLeave: parseInt(userData[6]) || 0,   // Index 6
                totalLeave: totalLeaveEntitlement,
                monthlyData: monthlyDataPayload,
                leaveTaken: leaveTaken,
                leaveBalance: leaveBalance,
                mcTaken: parseInt(userData[34]) || 0,             // Index 34
                mcBalance: parseInt(userData[35]) || 0,           // Index 35
                applications: userApplications
            }
        };

        // **** DEBUGGING LOGS ****
        console.log(`--- Payload for /api/leave-data for user: ${username} ---`);
        console.log('Raw userData from sheet (first few elements):', userData ? userData.slice(0, 10) : 'No userData');
        console.log('User Row Index used:', userSheetRow);
        console.log('Range used for userData:', `${SHEET_NAME}!A${userSheetRow}:AH${userSheetRow}`);
        console.log('Monthly Data being sent:', JSON.stringify(responsePayload.data.monthlyData, null, 2));
        console.log('Applications being sent:', JSON.stringify(responsePayload.data.applications, null, 2));
        // console.log('Full payload being sent:', JSON.stringify(responsePayload, null, 2)); // Can be very verbose

        res.json(responsePayload);

    } catch (error) {
        console.error(`Error fetching leave data for user ${req.session.user ? req.session.user.username : 'Unknown'}:`, error);
        res.status(500).json({ success: false, message: 'Server error fetching leave data.' });
    }
});

// Apply leave endpoint
app.post('/api/apply-leave', requireLogin, async (req, res) => {
    const { leaveType, startDate, endDate, reason, days } = req.body;
    const username = req.session.user.username;

    if (!leaveType || !startDate || !endDate || !days) {
        return res.status(400).json({ success: false, message: 'Missing required fields for leave application.' });
    }
    const numDays = parseInt(days);
    if (isNaN(numDays) || numDays <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid number of days.'});
    }

    try {
        const idResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:A`,
        });
        let nextId = 1;
        if (idResponse.data.values && idResponse.data.values.length > 0) {
            const ids = idResponse.data.values
                .slice(1) // Skip header
                .map(row => parseInt(row[0]))
                .filter(id => !isNaN(id));
            if (ids.length > 0) {
                nextId = Math.max(0, ...ids) + 1;
            } else {
                nextId = 1; // If only header or no numeric IDs
            }
        }

        const leaveApplicationRowData = [
            nextId.toString(), username, leaveType, startDate, endDate, reason || 'No reason provided', 'Pending'
        ];
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [leaveApplicationRowData] }
        });
        
        const newApplicationRowNumberInSheet = parseInt(appendResponse.data.updates.updatedRange.split('!A')[1].split(':')[0]);

        // TODO: Update user's leave balance in 'Leave Data' sheet (columns AG, AH)
        // This requires fetching current balance, adding 'numDays', then updating.
        // Example:
        // const userCurrentData = await sheets.spreadsheets.values.get({spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!AG${req.session.user.rowIndex}:AH${req.session.user.rowIndex}`});
        // let currentTaken = parseInt(userCurrentData.data.values[0][0]) || 0;
        // let currentBalance = parseInt(userCurrentData.data.values[0][1]) || 0;
        // await sheets.spreadsheets.values.update({spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!AG${req.session.user.rowIndex}`, valueInputOption: 'USER_ENTERED', requestBody: {values: [[currentTaken + numDays, currentBalance - numDays]]} });
        console.log(`Placeholder: Update leave balance for user ${username} by ${numDays} days.`);


        const managerEmail = await getManagerEmail(username);
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
                    <p>To approve or reject, please visit the dashboard. Application row: ${newApplicationRowNumberInSheet}</p>
                    <p><a href="${req.protocol}://${req.get('host')}/api/approve-leave?row=${newApplicationRowNumberInSheet}&id=${nextId}">Approve</a> | <a href="${req.protocol}://${req.get('host')}/api/reject-leave?row=${newApplicationRowNumberInSheet}&id=${nextId}">Reject</a> (Example links)</p>
                `
            };
            transporter.sendMail(mailOptionsToManager).catch(err => console.error('Error sending email to manager:', err));
        }
        res.json({ success: true, message: 'Leave application submitted.', applicationId: nextId.toString(), applicationRow: newApplicationRowNumberInSheet });
    } catch (error) {
        console.error('Error in /api/apply-leave:', error);
        res.status(500).json({ success: false, message: 'Server error submitting leave.' });
    }
});

// Approve/Reject Leave Endpoints
async function handleLeaveAction(req, res, action) {
    const { row: applicationRow, id: applicationIDFromQuery } = req.query;
    if (!applicationRow || isNaN(parseInt(applicationRow))) {
        return res.status(400).send('Valid application row number is required.');
    }
    const statusToSet = action === 'approve' ? 'Approved' : 'Rejected';
    try {
        const appDetailsRange = `${LEAVE_APPLICATION_SHEET}!A${applicationRow}:G${applicationRow}`;
        const appDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: appDetailsRange,
        });
        if (!appDetailsResponse.data.values || appDetailsResponse.data.values.length === 0) {
            return res.status(404).send(`Application not found at row ${applicationRow}.`);
        }
        const [appID, username, leaveType, startDate, endDate, reasonText, currentStatus] = appDetailsResponse.data.values[0];

        if (currentStatus === statusToSet) {
            return res.send(`Application ID ${appID} is already ${statusToSet}.`);
        }
        // Add logic here if rejecting an approved application, or approving a rejected one (e.g., adjust leave balances)

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[statusToSet]] }
        });

        const applicantEmail = await getApplicantEmail(username);
        if (applicantEmail) {
            const mailOptions = {
                from: process.env.EMAIL_USER, to: applicantEmail,
                subject: `Leave Application ${statusToSet} (ID: ${appID})`,
                html: `<p>Your leave application (ID: ${appID}) has been ${statusToSet.toLowerCase()}.</p>
                       <p>Details: ${leaveType}, ${startDate} to ${endDate}. Reason: ${reasonText || 'N/A'}</p>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error(`Error sending ${statusToSet} email:`, err));
        }
        res.send(`Leave application ID ${appID} (Row ${applicationRow}) has been ${statusToSet}.`);
    } catch (error) {
        console.error(`Error in /api/${action}-leave for row ${applicationRow}:`, error);
        res.status(500).send(`Error ${action}ing leave: ${error.message}`);
    }
}
app.get('/api/approve-leave', (req, res) => handleLeaveAction(req, res, 'approve'));
app.get('/api/reject-leave', (req, res) => handleLeaveAction(req, res, 'reject'));


// Helper functions to get emails
async function getSheetData(range) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    if (!response.data.values || response.data.values.length <= 1) return []; // No data or only header
    return response.data.values.slice(1); // Skip header
}

async function getApplicantEmail(username) { // Assumes Username in Col A, Email in Col C of SHEET_NAME
    try {
        const rows = await getSheetData(`${SHEET_NAME}!A:C`);
        const userRow = rows.find(row => row[0] === username);
        return userRow && userRow[2] ? userRow[2] : null;
    } catch (error) { console.error(`Error fetching email for ${username}:`, error); return null; }
}
async function getManagerEmail(username) { // Assumes Username Col A, Email Col C, ManagerUsername Col D of SHEET_NAME
    try {
        const rows = await getSheetData(`${SHEET_NAME}!A:D`);
        const userRow = rows.find(row => row[0] === username);
        if (!userRow || !userRow[3]) return null; // No manager username for this user
        const managerUsername = userRow[3];
        const managerRow = rows.find(row => row[0] === managerUsername); // Find manager in the same list
        return managerRow && managerRow[2] ? managerRow[2] : null; // Manager's email
    } catch (error) { console.error(`Error fetching manager email for ${username}'s manager:`, error); return null; }
}

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Logout error' });
        }
        res.clearCookie('connect.sid'); // Default session cookie name from express-session
        res.json({ success: true, message: "Logout successful" });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
