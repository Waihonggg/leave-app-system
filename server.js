const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
// const bcrypt = require('bcryptjs'); // Uncomment if you implement password hashing
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true, // Consider restricting this to your frontend URL in production
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.set('trust proxy', 1);

let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-very-secret-key-for-sessions',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000 * 2, // 2 hours, for example
        httpOnly: true,
    }
};

if (process.env.NODE_ENV === 'production') {
    sessionConfig.cookie.secure = true;
    sessionConfig.cookie.sameSite = 'lax';
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
        throw new Error('No Google credentials found. Set GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS, or provide credentials.json.');
    }
    auth.getClient().then(() => {
        console.log('Google Sheets authentication successful.');
    }).catch(err => {
        console.error('Google Sheets authentication failed:', err.message);
    });
} catch (error) {
    console.error('Error setting up Google Auth:', error.message);
    process.exit(1);
}

const SHEET_NAME = 'Leave Data'; // For user accounts, balances, emails, manager mapping
const LEAVE_APPLICATION_SHEET = 'Leave Application'; // For leave requests
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

if (!SPREADSHEET_ID) {
    console.error("FATAL: SPREADSHEET_ID environment variable is not set.");
    process.exit(1);
}
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("WARN: EMAIL_USER or EMAIL_PASS environment variables are not set. Email notifications will fail.");
}


async function initializeSheetHeaders() {
    try {
        console.log(`Verifying headers for SPREADSHEET_ID: ${SPREADSHEET_ID}`);
        const sheetsInstance = google.sheets({ version: 'v4', auth });
        
        // Define expected headers to make it easier to manage
        const leaveDataHeaders = [
            'Username', 'Password', 'Email', 'Manager Username', // A-D (0-3)
            'Carry Forward', 'Annual Leave Entitlement', 'Compassionate Leave Entitlement', 'Total Leave Entitlement', // E-H (4-7)
            'Jan Leave', 'Jan MC', 'Feb Leave', 'Feb MC', 'Mar Leave', 'Mar MC', // I-N (8-13)
            'Apr Leave', 'Apr MC', 'May Leave', 'May MC', 'Jun Leave', 'Jun MC', // O-T (14-19)
            'Jul Leave', 'Jul MC', 'Aug Leave', 'Aug MC', 'Sep Leave', 'Sep MC', // U-Z (20-25)
            'Oct Leave', 'Oct MC', 'Nov Leave', 'Nov MC', 'Dec Leave', 'Dec MC', // AA-AF (26-31)
            'Total Leave Taken', 'Leave Balance', 'Total MC Taken', 'MC Balance' // AG-AJ (32-35)
        ];
        const leaveApplicationHeaders = [
            'ID', 'Username', 'Leave Type', 'Start Date', 'End Date', 'Reason', 'Status' // A-G
        ];

        const userSheetCheck = await sheetsInstance.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A1:AJ1`
        });
        if (!userSheetCheck.data.values || !userSheetCheck.data.values[0] || userSheetCheck.data.values[0].length < leaveDataHeaders.length) {
            console.log(`Attempting to add/update headers to the ${SHEET_NAME} sheet...`);
            await sheetsInstance.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A1`,
                valueInputOption: 'RAW', requestBody: { values: [leaveDataHeaders] }
            });
            console.log(`${SHEET_NAME} sheet headers initialized/updated.`);
        }

        const appSheetCheck = await sheetsInstance.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!A1:G1`
        });
        if (!appSheetCheck.data.values || !appSheetCheck.data.values[0] || appSheetCheck.data.values[0].length < leaveApplicationHeaders.length) {
            console.log(`Attempting to add/update headers to the ${LEAVE_APPLICATION_SHEET} sheet...`);
            await sheetsInstance.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!A1`,
                valueInputOption: 'RAW', requestBody: { values: [leaveApplicationHeaders] }
            });
            console.log(`${LEAVE_APPLICATION_SHEET} sheet headers initialized/updated.`);
        }
        console.log('Sheet headers verification complete.');
    } catch (error) {
        console.error('Error during sheet header initialization:', error.message);
        console.error('Please ensure the Google Sheet ID is correct and the service account has edit permissions.');
    }
}

initializeSheetHeaders();

function requireLogin(req, res, next) {
    if (req.session && req.session.user && req.session.user.username) {
        next();
    } else {
        console.warn('requireLogin: Unauthorized access attempt. Session:', JSON.stringify(req.session));
        if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
            return res.status(401).json({ success: false, message: 'Not authenticated. Please login.' });
        } else {
            return res.redirect('/');
        }
    }
}

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
        res.redirect('/dashboard.html');
    } else {
        res.sendFile(path.join(__dirname, 'login.html'));
    }
});
app.get('/apply-leave.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'apply-leave.html'));
});
app.get('/dashboard.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});


// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt for username: ${username}`);
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    try {
        const range = `${SHEET_NAME}!A:B`; // Col A: Username, Col B: Password (plain text)
        console.log(`Fetching users from sheet range: ${range}`);
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
        
        if (!response.data.values || response.data.values.length <= 1) { // <=1 to account for potential header
             console.warn(`No user data found in sheet or only header present.`);
             return res.status(401).json({ success: false, message: 'Login failed. User data sheet might be empty.' });
        }
        const rows = response.data.values;
        let userFound = null;
        let userSheetIndex = -1; // 0-based index in the sheet

        for (let i = 1; i < rows.length; i++) { // Start from 1 to skip header
            if (rows[i][0] === username && rows[i][1] === password) { // PLAIN TEXT PASSWORD - NOT FOR PRODUCTION
                // In a real app, use bcrypt: const match = await bcrypt.compare(password, rows[i][1]); if (match)
                userFound = { username: rows[i][0] };
                userSheetIndex = i;
                break;
            }
        }

        if (userFound) {
            req.session.user = { username: userFound.username, rowIndex: userSheetIndex + 1 }; // rowIndex is 1-based for Sheets
            req.session.save(err => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ success: false, message: 'Session error during login.' });
                }
                console.log(`Login successful for ${username}. Session created:`, JSON.stringify(req.session.user));
                res.json({ success: true, message: 'Login successful', username: userFound.username });
            });
        } else {
            console.warn(`Invalid credentials for username: ${username}`);
            res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
    } catch (error) {
        console.error('Login server error:', error);
        res.status(500).json({ success: false, message: 'Server error during login processing.' });
    }
});

// Get user leave data (for dashboard)
app.get('/api/leave-data', requireLogin, async (req, res) => {
    const username = req.session.user.username;
    const userSheetRow = req.session.user.rowIndex; // 1-based index from login
    console.log(`--- /api/leave-data CALLED for user: ${username}, row: ${userSheetRow} ---`);

    try {
        const userDataRange = `${SHEET_NAME}!A${userSheetRow}:AJ${userSheetRow}`; // Up to column AJ (index 35)
        console.log(`Fetching userData from range: ${userDataRange}`);
        const userDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: userDataRange,
        });

        if (!userDataResponse.data.values || userDataResponse.data.values.length === 0) {
            console.error(`No data found for user ${username} at row ${userSheetRow} in ${SHEET_NAME}`);
            return res.status(404).json({ success: false, message: `User data not found for ${username}.` });
        }
        const userData = userDataResponse.data.values[0];
        console.log('Raw userData from sheet (first 10 cols):', userData ? userData.slice(0, 10) : 'No userData array');

        const leaveApplicationsRange = `${LEAVE_APPLICATION_SHEET}!A:G`;
        console.log(`Fetching leave applications from range: ${leaveApplicationsRange}`);
        const leaveApplicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: leaveApplicationsRange,
        });
        
        let userApplications = [];
        if (leaveApplicationsResponse.data.values && leaveApplicationsResponse.data.values.length > 1) {
            userApplications = leaveApplicationsResponse.data.values.slice(1)
                .filter(row => row.length >= 7 && row[1] === username)
                .map(app => ({
                    id: app[0], username: app[1], leaveType: app[2], startDate: app[3],
                    endDate: app[4], reason: app[5] || 'N/A', status: app[6]
                }));
        }
        console.log(`Found ${userApplications.length} applications for ${username}`);
        
        // Column indices (0-based) from your leaveDataHeaders definition
        // E.g., 'Total Leave Entitlement' is index 7, 'Jan Leave' is 8, 'Total Leave Taken' is 32
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
        
        const responsePayload = {
            success: true,
            data: {
                username: userData[0] || username,
                carryForward: parseInt(userData[4]) || 0,
                annualLeave: parseInt(userData[5]) || 0, // This is 'Annual Leave Entitlement'
                compassionateLeave: parseInt(userData[6]) || 0,
                totalLeave: parseInt(userData[7]) || 0, // 'Total Leave Entitlement'
                monthlyData: monthlyDataPayload,
                leaveTaken: parseInt(userData[32]) || 0,
                leaveBalance: parseInt(userData[33]) || 0,
                mcTaken: parseInt(userData[34]) || 0,
                mcBalance: parseInt(userData[35]) || 0,
                applications: userApplications
            }
        };
        console.log('Monthly Data being sent:', JSON.stringify(responsePayload.data.monthlyData, null, 0));
        res.json(responsePayload);

    } catch (error) {
        console.error(`Error in /api/leave-data for user ${username}:`, error);
        res.status(500).json({ success: false, message: 'Server error fetching leave data.' });
    }
});

// Apply leave endpoint
app.post('/api/apply-leave', requireLogin, async (req, res) => {
    console.log('--- /api/apply-leave endpoint CALLED ---');
    console.log('Session user:', JSON.stringify(req.session.user));
    console.log('Request body:', JSON.stringify(req.body));

    const { leaveType, startDate, endDate, reason, days } = req.body;
    const username = req.session.user.username;
    const userRowIndexInLeaveDataSheet = req.session.user.rowIndex; // 1-based

    if (!leaveType || !startDate || !endDate || !days) {
        console.error('/api/apply-leave: Validation failed - Missing fields.');
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    const numDays = parseInt(days);
    if (isNaN(numDays) || numDays <= 0) {
        console.error('/api/apply-leave: Validation failed - Invalid days:', days);
        return res.status(400).json({ success: false, message: 'Invalid number of days.' });
    }

    // Weekend Check (simple version: disallow start/end on weekend)
    const startDt = new Date(startDate);
    const endDt = new Date(endDate);
    const startDay = startDt.getUTCDay(); // 0=Sun, 6=Sat
    const endDay = endDt.getUTCDay();
    if (startDay === 0 || startDay === 6 || endDay === 0 || endDay === 6) {
        console.warn('/api/apply-leave: Attempt to apply leave on weekend start/end.');
        // return res.status(400).json({ success: false, message: 'Leave start or end date cannot be on a weekend.' });
    }
    if (endDt < startDt) {
        console.error('/api/apply-leave: Validation failed - End date before start date.');
        return res.status(400).json({ success: false, message: 'End date cannot be before start date.' });
    }
    // TODO: Add check for sufficient leave balance before proceeding

    try {
        console.log('/api/apply-leave: Getting next ID...');
        const idResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!A:A`,
        });
        let nextId = 1;
        if (idResponse.data.values && idResponse.data.values.length > 1) { // Header + data
            const ids = idResponse.data.values.slice(1).map(r => parseInt(r[0])).filter(id => !isNaN(id));
            if (ids.length > 0) nextId = Math.max(0, ...ids) + 1;
        }
        console.log(`/api/apply-leave: Next ID: ${nextId}`);

        const leaveApplicationRowData = [
            nextId.toString(), username, leaveType, startDate, endDate, reason || 'N/A', 'Pending'
        ];
        console.log('/api/apply-leave: Appending to sheet:', JSON.stringify(leaveApplicationRowData));
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!A:G`,
            valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [leaveApplicationRowData] }
        });
        const newAppRowStr = appendResponse.data.updates.updatedRange.split('!A')[1];
        const newApplicationRowNumberInSheet = parseInt(newAppRowStr.split(':')[0]);
        console.log(`/api/apply-leave: Appended to LEAVE_APPLICATION_SHEET, row: ${newApplicationRowNumberInSheet}`);

        // --- UPDATE LEAVE BALANCE ---
        console.log(`/api/apply-leave: Updating balance for ${username} (data sheet row ${userRowIndexInLeaveDataSheet}) by ${numDays} days.`);
        const balanceUpdateRange = `${SHEET_NAME}!AG${userRowIndexInLeaveDataSheet}:AH${userRowIndexInLeaveDataSheet}`; // AG=Taken, AH=Balance
        const entitlementCell = `${SHEET_NAME}!H${userRowIndexInLeaveDataSheet}`; // H=Total Entitlement
        
        try {
            const sheetValues = await sheets.spreadsheets.values.batchGet({
                spreadsheetId: SPREADSHEET_ID,
                ranges: [balanceUpdateRange, entitlementCell]
            });
            const currentBalanceValues = sheetValues.data.valueRanges[0].values;
            const entitlementValues = sheetValues.data.valueRanges[1].values;

            let currentTaken = 0;
            if (currentBalanceValues && currentBalanceValues[0] && currentBalanceValues[0][0]) {
                currentTaken = parseInt(currentBalanceValues[0][0]) || 0;
            }
            let totalEntitlement = 0;
            if (entitlementValues && entitlementValues[0] && entitlementValues[0][0]) {
                totalEntitlement = parseInt(entitlementValues[0][0]) || 0;
            }
            console.log(`/api/apply-leave: Current taken: ${currentTaken}, Total entitlement: ${totalEntitlement}`);

            const newTotalTaken = currentTaken + numDays;
            const newBalance = totalEntitlement - newTotalTaken;
            console.log(`/api/apply-leave: New total taken: ${newTotalTaken}, New balance: ${newBalance}`);

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID, range: balanceUpdateRange,
                valueInputOption: 'USER_ENTERED', requestBody: { values: [[newTotalTaken, newBalance]] }
            });
            console.log(`/api/apply-leave: Balance updated for ${username}.`);
        } catch (balanceError) {
            console.error(`/api/apply-leave: ERROR updating balance for ${username}:`, balanceError);
            // Consider if this error should make the whole application fail.
        }
        // --- END BALANCE UPDATE ---

        console.log('/api/apply-leave: Getting manager email...');
        const managerEmail = await getManagerEmail(username);
        if (managerEmail && process.env.EMAIL_USER) {
            console.log(`/api/apply-leave: Manager email: ${managerEmail}. Sending email...`);
            const host = req.get('host');
            const protocol = req.protocol;
            const mailOptionsToManager = {
                from: process.env.EMAIL_USER, to: managerEmail,
                subject: `New Leave Application for Approval - ${username} (ID: ${nextId})`,
                html: `
                    <p>A new leave application (ID: ${nextId}) by ${username} requires approval.</p>
                    <p><strong>Type:</strong> ${leaveType}</p>
                    <p><strong>Start:</strong> ${startDate}, <strong>End:</strong> ${endDate} (<strong>Days:</strong> ${days})</p>
                    <p><strong>Reason:</strong> ${reason || 'N/A'}</p>
                    <hr>
                    <p>Application submitted via system. Ref Row: ${newApplicationRowNumberInSheet}.</p>
                    <p><em>(Direct approval links can be added if GET endpoints are secured or use tokens)</em></p>
                    <p><a href="${protocol}://${host}/api/approve-leave?row=${newApplicationRowNumberInSheet}&id=${nextId}">Approve (Example)</a></p>
                    <p><a href="${protocol}://${host}/api/reject-leave?row=${newApplicationRowNumberInSheet}&id=${nextId}">Reject (Example)</a></p>`
            };
            try {
                await transporter.sendMail(mailOptionsToManager);
                console.log('/api/apply-leave: Email sent to manager.');
            } catch (emailError) {
                console.error('/api/apply-leave: FAILED to send email to manager:', emailError);
            }
        } else {
            if(!process.env.EMAIL_USER) console.warn('/api/apply-leave: EMAIL_USER not set. Cannot send email.');
            else console.warn(`/api/apply-leave: Manager email not found for ${username}. Cannot send email.`);
        }
        res.json({ success: true, message: 'Leave application submitted.', applicationId: nextId.toString() });
    } catch (error) {
        console.error('--- ERROR in /api/apply-leave (outer try-catch) ---:', error);
        res.status(500).json({ success: false, message: `Server error: ${error.message}` });
    }
});

// Approve/Reject Leave Endpoints
async function handleLeaveAction(req, res, action) {
    const { row: applicationRow, id: applicationIDFromQuery } = req.query; // applicationRow is 1-based sheet row
    const statusToSet = action === 'approve' ? 'Approved' : 'Rejected';
    console.log(`--- /api/${action}-leave CALLED for row: ${applicationRow}, id: ${applicationIDFromQuery} ---`);

    if (!applicationRow || isNaN(parseInt(applicationRow)) || parseInt(applicationRow) <=1 ) { // Row must be > 1 (data row)
        console.error(`/api/${action}-leave: Invalid application row: ${applicationRow}`);
        return res.status(400).send('Valid application row number (>1) is required.');
    }
    try {
        const appDetailsRange = `${LEAVE_APPLICATION_SHEET}!A${applicationRow}:G${applicationRow}`;
        console.log(`/api/${action}-leave: Fetching details from ${appDetailsRange}`);
        const appDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: appDetailsRange,
        });

        if (!appDetailsResponse.data.values || appDetailsResponse.data.values.length === 0) {
            console.error(`/api/${action}-leave: Application not found at row ${applicationRow}.`);
            return res.status(404).send(`Application not found at row ${applicationRow}.`);
        }
        const [appID, username, leaveType, startDate, endDate, reasonText, currentStatus] = appDetailsResponse.data.values[0];
        console.log(`/api/${action}-leave: Details - ID:${appID}, User:${username}, CurrentStatus:${currentStatus}`);

        if (currentStatus === statusToSet) {
            console.log(`/api/${action}-leave: Application ID ${appID} already ${statusToSet}.`);
            return res.send(`Application ID ${appID} is already ${statusToSet}.`);
        }

        // TODO: If action is 'approve', check if user has enough balance.
        // TODO: If action is 'reject' for a previously 'Approved' application, revert leave days from balance.
        // This requires fetching 'days' for this application (not currently stored, might need to calc or add a 'Days' column to LEAVE_APPLICATION_SHEET)

        console.log(`/api/${action}-leave: Updating status to ${statusToSet} for app ID ${appID} at G${applicationRow}`);
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[statusToSet]] }
        });

        const applicantEmail = await getApplicantEmail(username);
        if (applicantEmail && process.env.EMAIL_USER) {
            console.log(`/api/${action}-leave: Applicant email ${applicantEmail}. Sending notification.`);
            const mailOptions = {
                from: process.env.EMAIL_USER, to: applicantEmail,
                subject: `Leave Application ${statusToSet} (ID: ${appID})`,
                html: `<p>Your leave application (ID: ${appID}) has been ${statusToSet.toLowerCase()}.</p>
                       <p>Details: ${leaveType}, ${startDate} to ${endDate}. Reason: ${reasonText || 'N/A'}</p>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error(`/api/${action}-leave: FAILED to send email to applicant:`, err));
        } else {
             if(!process.env.EMAIL_USER) console.warn(`/api/${action}-leave: EMAIL_USER not set. Cannot send email.`);
             else console.warn(`/api/${action}-leave: Applicant email not found for ${username}.`);
        }
        res.send(`Leave application ID ${appID} (Row ${applicationRow}) has been ${statusToSet}.`);
    } catch (error) {
        console.error(`--- ERROR in /api/${action}-leave for row ${applicationRow} ---:`, error);
        res.status(500).send(`Error processing leave ${action}: ${error.message}`);
    }
}
app.get('/api/approve-leave', (req, res) => handleLeaveAction(req, res, 'approve'));
app.get('/api/reject-leave', (req, res) => handleLeaveAction(req, res, 'reject'));


// Helper functions to get emails more robustly
async function getSheetDataRows(sheetName, columns) { // e.g., columns 'A:D'
    try {
        const range = `${sheetName}!${columns}`;
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
        if (!response.data.values || response.data.values.length <= 1) { // No data or only header
            console.warn(`getSheetDataRows: No data or only header in ${sheetName} range ${columns}`);
            return [];
        }
        return response.data.values.slice(1); // Skip header row
    } catch (error) {
        console.error(`getSheetDataRows: Error fetching from ${sheetName} range ${columns}:`, error.message);
        return []; // Return empty on error to prevent crashes
    }
}

async function getApplicantEmail(username) {
    const rows = await getSheetDataRows(SHEET_NAME, 'A:C'); // Username in A (idx 0), Email in C (idx 2)
    const userRow = rows.find(row => row[0] === username);
    return userRow && userRow[2] ? userRow[2] : null;
}
async function getManagerEmail(username) {
    const rows = await getSheetDataRows(SHEET_NAME, 'A:D'); // User A(0), Email C(2), ManagerUsername D(3)
    const userRow = rows.find(row => row[0] === username);
    if (!userRow || !userRow[3]) return null;
    const managerUsername = userRow[3];
    const managerRow = rows.find(row => row[0] === managerUsername);
    return managerRow && managerRow[2] ? managerRow[2] : null;
}

// Logout
app.post('/api/logout', (req, res) => {
    console.log(`Logout attempt for session: ${req.session.id}`);
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, message: 'Logout error' });
        }
        res.clearCookie('connect.sid'); // Default name for express-session cookie
        console.log('Session destroyed, cookie cleared.');
        res.json({ success: true, message: "Logout successful" });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}. NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`Access application at http://localhost:${PORT} (if running locally)`);
});
