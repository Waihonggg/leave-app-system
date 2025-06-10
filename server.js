const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
// const bcrypt = require('bcryptjs'); // For hashed passwords; not used in current plain text password check
const path = require('path'); // Correctly require the 'path' module
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config(); // For local development with a .env file

const app = express();
const PORT = process.env.PORT || 3000; // Render sets PORT

// Middleware
app.use(cors({
    origin: true, // Be more specific in production, e.g., your frontend URL
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // Serves static files from the root (e.g., login.html, dashboard.html)
app.set('trust proxy', 1); // Important for Render/proxies if using secure cookies

// Session Configuration
let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-very-secure-and-long-session-secret-key-replace-this', // CHANGE THIS!
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        // secure: process.env.NODE_ENV === 'production', // Handled below
        // sameSite: 'lax'
    }
};

if (process.env.NODE_ENV === 'production') {
    console.log("Production environment detected. Setting secure session cookies.");
    sessionConfig.cookie.secure = true;
    sessionConfig.cookie.sameSite = 'lax';
} else {
    console.log("Development environment detected. Session cookies will not be 'secure'.");
}
app.use(session(sessionConfig));

// Google Sheets Setup
let auth;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Leave Data'; // For user details, balances - matches your sheet
const LEAVE_APPLICATION_SHEET = 'Leave Application'; // For leave requests

if (!SPREADSHEET_ID) {
    console.error("FATAL ERROR: SPREADSHEET_ID environment variable is not set.");
    process.exit(1); // Exit if critical config is missing
}

try {
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        console.log("Using GOOGLE_CREDENTIALS_JSON environment variable for auth.");
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        console.log(`Using GOOGLE_APPLICATION_CREDENTIALS file: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
        auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else if (fs.existsSync('credentials.json')) {
        console.log("Using local credentials.json file for auth (for local development).");
        auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else {
        throw new Error('No Google credentials found. Set GOOGLE_CREDENTIALS_JSON, or ensure credentials.json exists for local dev, or GOOGLE_APPLICATION_CREDENTIALS points to a valid file in your deployment environment.');
    }

    auth.getClient().then(() => {
        console.log('Google Sheets authentication successful.');
        initializeSheetHeaders(); // Initialize headers after auth is confirmed
    }).catch(err => {
        console.error('Google Sheets authentication failed:', err.message);
        // Depending on severity, you might want to process.exit(1) here too
    });
} catch (error) {
    console.error('FATAL ERROR setting up Google Auth:', error.message);
    process.exit(1);
}

const sheets = google.sheets({ version: 'v4', auth });

async function initializeSheetHeaders() {
    try {
        // Check/initialize 'Leave Data' sheet
        // Based on your provided headers: Username, Password, Email, Manager Username, Carry forward 2024, 2025 AL, CCL, Total 2025, Jan, Jan MC, ..., Dec MC, Leave Taken, Leave Balance, MC Taken, MC Balance, WFH count
        const leaveDataHeaders = ['Username', 'Password', 'Email', 'Manager Username', 'Carry forward 2024', '2025 AL', 'CCL', 'Total 2025', 'Jan Leave', 'Jan MC', 'Feb Leave', 'Feb MC', 'Mar Leave', 'Mar MC', 'Apr Leave', 'Apr MC', 'May Leave', 'May MC', 'Jun Leave', 'Jun MC', 'Jul Leave', 'Jul MC', 'Aug Leave', 'Aug MC', 'Sep Leave', 'Sep MC', 'Oct Leave', 'Oct MC', 'Nov Leave', 'Nov MC', 'Dec Leave', 'Dec MC', 'Leave Taken', 'Leave Balance', 'MC Taken', 'MC Balance', 'WFH count'];
        const userSheetCheck = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:${String.fromCharCode(64 + leaveDataHeaders.length)}1` // Dynamically create range like A1:AK1
        });

        let headersMatch = userSheetCheck.data.values && userSheetCheck.data.values[0] && userSheetCheck.data.values[0].length === leaveDataHeaders.length;
        // Optional: Deeper check if headers actually match
        // if (headersMatch) {
        //     for(let i=0; i<leaveDataHeaders.length; i++) {
        //         if (userSheetCheck.data.values[0][i] !== leaveDataHeaders[i]) {
        //             headersMatch = false;
        //             break;
        //         }
        //     }
        // }

        if (!headersMatch) {
            console.log(`Attempting to set headers for the ${SHEET_NAME} sheet as they seem missing or incorrect...`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: [leaveDataHeaders] }
            });
            console.log(`${SHEET_NAME} sheet headers set.`);
        } else {
            console.log(`${SHEET_NAME} sheet headers appear to be correctly in place.`);
        }

        // Check/initialize 'Leave Application' sheet
        const appSheetHeaders = ['ID', 'Username', 'Leave Type', 'Start Date', 'End Date', 'Reason', 'Status'];
        const appSheetCheck = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A1:G1`
        });
        if (!appSheetCheck.data.values || !appSheetCheck.data.values[0] || appSheetCheck.data.values[0].length < appSheetHeaders.length) {
            console.log(`Adding headers to the ${LEAVE_APPLICATION_SHEET} sheet...`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${LEAVE_APPLICATION_SHEET}!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: [appSheetHeaders] }
            });
             console.log(`${LEAVE_APPLICATION_SHEET} sheet headers set.`);
        } else {
            console.log(`${LEAVE_APPLICATION_SHEET} sheet headers appear to be correctly in place.`);
        }
        console.log('Sheet headers verification/initialization complete.');
    } catch (error) {
        console.error('Error initializing sheet headers:', error.message);
        // This might not be fatal, but logs the error
    }
}

// Middleware to check if user is logged in
function requireLogin(req, res, next) {
    if (req.session && req.session.user && req.session.user.username) {
        next();
    } else {
        console.warn("requireLogin: User not authenticated. Session:", req.session);
        if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
            return res.status(401).json({ success: false, message: 'Not authenticated. Please login.' });
        } else {
            return res.redirect('/'); // Redirect to login page for non-AJAX requests
        }
    }
}

// Nodemailer setup
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail', // Or your email provider
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS // Use App Password for Gmail if 2FA is enabled
        }
    });
    console.log("Nodemailer configured with EMAIL_USER and EMAIL_PASS.");
} else {
    console.warn("WARN: EMAIL_USER or EMAIL_PASS environment variables are not set. Email notifications will fail.");
    // Create a dummy transporter or skip email sending logic if transporter is undefined
    transporter = null;
}


// --- Static Pages ---
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/dashboard.html');
    } else {
        res.sendFile(path.join(__dirname, 'login.html'));
    }
});

app.get('/dashboard.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/apply-leave.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'apply-leave.html'));
});


// --- API Endpoints ---

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt for username: ${username}`);
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    try {
        // Fetch Username (Col A, index 0) and Password (Col B, index 1)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:B`,
        });
        const rows = response.data.values;
        if (!rows || rows.length <= 1) { // <=1 to account for only header
             console.warn('Login failed. User data sheet might be empty or only has headers.');
             return res.status(401).json({ success: false, message: 'Login failed. No user data found.' });
        }
        
        let userFound = null;
        let userIndexInSheet = -1; // 0-based index in the sheet

        // Skip header row (index 0)
        for (let i = 1; i < rows.length; i++) {
            // Ensure row and cells exist before accessing
            if (rows[i] && rows[i][0] && rows[i][1] &&
                rows[i][0].trim().toLowerCase() === username.trim().toLowerCase() &&
                rows[i][1] === password) { // Plain text password check
                userFound = { username: rows[i][0].trim() };
                userIndexInSheet = i; // 0-based index from sheet
                break;
            }
        }

        if (userFound) {
            req.session.user = {
                username: userFound.username,
                rowIndex: userIndexInSheet + 1 // Store 1-based rowIndex for direct sheet use (A1 notation)
            };
            req.session.save(err => {
                if (err) {
                    console.error('Session save error during login:', err);
                    return res.status(500).json({ success: false, message: 'Session error during login.' });
                }
                console.log(`User ${userFound.username} logged in successfully. Session ID: ${req.sessionID}`);
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
    const userRowInSheet = req.session.user.rowIndex; // 1-based index
    console.log(`Fetching leave data for user: ${username}, sheet row: ${userRowInSheet}`);

    try {
        // Your sheet headers: Username, Password, Email, Manager Username, Carry forward 2024, 2025 AL, CCL, Total 2025, Jan Leave, Jan MC, ..., Dec MC, Leave Taken, Leave Balance, MC Taken, MC Balance, WFH count
        // Indices for userData array (0-based):
        // 0: Username, 1: Password, 2: Email, 3: Manager Username
        // 4: Carry forward 2024
        // 5: 2025 AL
        // 6: CCL
        // 7: Total 2025 (Total Entitlement)
        // 8: Jan Leave, 9: Jan MC
        // ...
        // 30: Dec Leave, 31: Dec MC
        // 32: Leave Taken
        // 33: Leave Balance
        // 34: MC Taken
        // 35: MC Balance
        // 36: WFH count
        const userDataRange = `${SHEET_NAME}!A${userRowInSheet}:AK${userRowInSheet}`; // A to AK covers 37 columns
        console.log(`Fetching user data from range: ${userDataRange}`);
        const userDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: userDataRange,
        });

        if (!userDataResponse.data.values || userDataResponse.data.values.length === 0 || !userDataResponse.data.values[0]) {
            console.error(`No data found for user ${username} at row ${userRowInSheet} in ${SHEET_NAME}`);
            return res.status(404).json({ success: false, message: 'User data not found in sheet.' });
        }
        const userData = userDataResponse.data.values[0];
        console.log(`Raw userData for ${username} (first 5 elements):`, userData.slice(0,5));


        // Fetch all leave applications for the logged-in user
        const leaveApplicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`, // ID, Username, Type, Start, End, Reason, Status
        });
        
        let userApplications = [];
        if (leaveApplicationsResponse.data.values && leaveApplicationsResponse.data.values.length > 1) { // Assuming header row
            userApplications = leaveApplicationsResponse.data.values.slice(1) // Skip header
                .filter(row => row && row.length >= 2 && row[1] && row[1].trim().toLowerCase() === username.toLowerCase()) // Ensure row[1] (Username) exists and matches
                .map(app => ({
                    id: app[0] || 'N/A',
                    username: app[1] || 'N/A',
                    leaveType: app[2] || 'N/A',
                    startDate: app[3] || 'N/A',
                    endDate: app[4] || 'N/A',
                    reason: app[5] || 'No reason provided',
                    status: app[6] || 'Unknown'
                }));
        }
        console.log(`Found ${userApplications.length} applications for user ${username}`);
        
        const monthlyDataPayload = {
            Jan:   { leave: parseInt(userData[8])  || 0, mc: parseInt(userData[9])  || 0 },
            Feb:   { leave: parseInt(userData[10]) || 0, mc: parseInt(userData[11]) || 0 },
            March: { leave: parseInt(userData[12]) || 0, mc: parseInt(userData[13]) || 0 },
            Apr:   { leave: parseInt(userData[14]) || 0, mc: parseInt(userData[15]) || 0 },
            May:   { leave: parseInt(userData[16]) || 0, mc: parseInt(userData[17]) || 0 },
            June:  { leave: parseInt(userData[18]) || 0, mc: parseInt(userData[19]) || 0 },
            July:  { leave: parseInt(userData[20]) || 0, mc: parseInt(userData[21]) || 0 },
            Aug:   { leave: parseInt(userData[22]) || 0, mc: parseInt(userData[23]) || 0 },
            Sept:  { leave: parseInt(userData[24]) || 0, mc: parseInt(userData[25]) || 0 },
            Oct:   { leave: parseInt(userData[26]) || 0, mc: parseInt(userData[27]) || 0 },
            Nov:   { leave: parseInt(userData[28]) || 0, mc: parseInt(userData[29]) || 0 },
            Dec:   { leave: parseInt(userData[30]) || 0, mc: parseInt(userData[31]) || 0 }
        };
        
        const responsePayload = {
            success: true,
            data: {
                username: userData[0] || username, // From Col A
                carryForward: parseInt(userData[4]) || 0,
                annualLeave: parseInt(userData[5]) || 0,
                compassionateLeave: parseInt(userData[6]) || 0,
                totalLeave: parseInt(userData[7]) || 0, // Total Entitlement
                monthlyData: monthlyDataPayload,
                leaveTaken: parseInt(userData[32]) || 0,
                leaveBalance: parseInt(userData[33]) || 0,
                mcTaken: parseInt(userData[34]) || 0,
                mcBalance: parseInt(userData[35]) || 0,
                wfhCount: parseInt(userData[36]) || 0,
                applications: userApplications
            }
        };
        console.log(`Successfully prepared leave data payload for ${username}. Monthly Jan Leave: ${responsePayload.data.monthlyData.Jan.leave}`);
        res.json(responsePayload);

    } catch (error) {
        console.error(`Error fetching leave data for user ${username}:`, error);
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
        console.error('/api/apply-leave: Validation failed - Missing required fields.');
        return res.status(400).json({ success: false, message: 'Missing required fields for leave application.' });
    }
    const numDays = parseInt(days);
    if (isNaN(numDays) || numDays <= 0) {
        console.error('/api/apply-leave: Validation failed - Invalid number of days.');
        return res.status(400).json({ success: false, message: 'Invalid number of days (must be > 0).' });
    }

    // Basic Weekend Check (can be expanded)
    const startDt = new Date(startDate);
    const endDt = new Date(endDate);
    // Note: getUTCDay() is good if dates are consistently UTC. If local, use getDay().
    // For simplicity, assuming dates are handled as local time by user input.
    const startDay = startDt.getDay(); // 0 = Sunday, 6 = Saturday
    const endDay = endDt.getDay();

    if (numDays === 1 && (startDay === 0 || startDay === 6)) {
        console.warn('/api/apply-leave: Single day application on a weekend.');
        return res.status(400).json({ success: false, message: 'Single day leave cannot be on a weekend.' });
    }
    // Add more complex logic for multi-day leaves spanning weekends if needed

    try {
        console.log('/api/apply-leave: Attempting to get next ID from LEAVE_APPLICATION_SHEET...');
        const idResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!A:A`,
        });
        let nextId = 1;
        if (idResponse.data.values && idResponse.data.values.length > 1) { // Header + data
            const ids = idResponse.data.values.slice(1).map(row => parseInt(row[0])).filter(id => !isNaN(id));
            if (ids.length > 0) nextId = Math.max(0, ...ids) + 1;
        }
        console.log(`/api/apply-leave: Next application ID determined: ${nextId}`);

        const leaveApplicationRowData = [
            nextId.toString(), username, leaveType, startDate, endDate, reason || '', 'Pending'
        ];

        console.log('/api/apply-leave: Attempting to append to LEAVE_APPLICATION_SHEET:', JSON.stringify(leaveApplicationRowData));
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID, range: `${LEAVE_APPLICATION_SHEET}!A:G`,
            valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [leaveApplicationRowData] }
        });
        console.log('/api/apply-leave: Append to sheet successful.');
        const newApplicationRowNumberInSheet = parseInt(appendResponse.data.updates.updatedRange.split('!A')[1].split(':')[0]);


        // Update Leave Balance in 'Leave Data' sheet (Columns AG: Leave Taken, AH: Leave Balance)
        // Indices from your sheet: 32: Leave Taken, 33: Leave Balance, 7: Total 2025 (Entitlement)
        const balanceUpdateRange = `${SHEET_NAME}!AG${userRowIndexInLeaveDataSheet}:AH${userRowIndexInLeaveDataSheet}`; // AG=Taken, AH=Balance
        const entitlementCell = `${SHEET_NAME}!H${userRowIndexInLeaveDataSheet}`; // H = Total Entitlement
        
        console.log(`/api/apply-leave: Updating balance. Fetching current taken from AG${userRowIndexInLeaveDataSheet} and entitlement from H${userRowIndexInLeaveDataSheet}`);
        
        const sheetValues = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [
                `${SHEET_NAME}!AG${userRowIndexInLeaveDataSheet}`, // Current Leave Taken
                entitlementCell                               // Total Entitlement
            ]
        });

        let currentTaken = 0;
        if (sheetValues.data.valueRanges[0] && sheetValues.data.valueRanges[0].values) {
            currentTaken = parseInt(sheetValues.data.valueRanges[0].values[0][0]) || 0;
        }
        let totalEntitlement = 0;
        if (sheetValues.data.valueRanges[1] && sheetValues.data.valueRanges[1].values) {
            totalEntitlement = parseInt(sheetValues.data.valueRanges[1].values[0][0]) || 0;
        }
        console.log(`/api/apply-leave: Current Taken: ${currentTaken}, Total Entitlement: ${totalEntitlement}`);

        const newTotalTaken = currentTaken + numDays;
        const newBalance = totalEntitlement - newTotalTaken;
        console.log(`/api/apply-leave: New Total Taken: ${newTotalTaken}, New Balance: ${newBalance}`);

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID, range: balanceUpdateRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newTotalTaken, newBalance]] }
        });
        console.log(`/api/apply-leave: Leave balance updated in sheet for ${username}.`);


        if (transporter) {
            console.log('/api/apply-leave: Attempting to get manager email...');
            const managerEmailAddress = await getManagerEmail(username);
            if (managerEmailAddress) {
                console.log(`/api/apply-leave: Manager email found: ${managerEmailAddress}. Sending email...`);
                const mailOptions = {
                    from: process.env.EMAIL_USER, to: managerEmailAddress,
                    subject: `New Leave Application for Approval - ${username} (ID: ${nextId})`,
                    html: `<p>A new leave application (ID: ${nextId}) has been submitted by ${username} and requires your approval.</p>
                           <p><strong>Leave Type:</strong> ${leaveType}</p>
                           <p><strong>Dates:</strong> ${startDate} to ${endDate} (${numDays} day(s))</p>
                           <p><strong>Reason:</strong> ${reason || 'N/A'}</p>
                           <hr>
                           <p>To approve or reject this application, please visit the dashboard or use the links below (if configured):</p>
                           <p>Application Row in Sheet (for reference): ${newApplicationRowNumberInSheet}</p>
                           <p><i>(Approval links via email can be added here if direct approval/rejection endpoints are robustly secured)</i></p>`
                };
                await transporter.sendMail(mailOptions);
                console.log('/api/apply-leave: Email sent to manager successfully.');
            } else {
                console.warn(`/api/apply-leave: Manager email not found for user ${username}. Cannot send notification email.`);
            }
        } else {
             console.warn('/api/apply-leave: Nodemailer not configured. Skipping email notification.');
        }

        res.json({ success: true, message: 'Leave application submitted successfully.', applicationId: nextId.toString() });

    } catch (error) {
        console.error('--- ERROR in /api/apply-leave ---:', error.message, error.stack);
        res.status(500).json({ success: false, message: `Server error submitting leave: ${error.message}` });
    }
});

// Approve/Reject Leave Endpoints (Basic - requires secure admin/manager role check in real app)
async function handleLeaveAction(req, res, action) {
    const { row: applicationRowInSheet, id: applicationID } = req.query; // row is 1-based from sheet
    console.log(`handleLeaveAction: Action: ${action}, Row: ${applicationRowInSheet}, ID: ${applicationID}`);

    if (!applicationRowInSheet || isNaN(parseInt(applicationRowInSheet)) || !applicationID) {
        return res.status(400).send('Valid application row number and ID are required.');
    }
    const statusToSet = action === 'approve' ? 'Approved' : 'Rejected';
    const statusColumn = 'G'; // Assuming Status is in Column G

    try {
        // Optional: Fetch application details to verify ID and get applicant username for email
        const appDetailsRange = `${LEAVE_APPLICATION_SHEET}!A${applicationRowInSheet}:${statusColumn}${applicationRowInSheet}`;
        const appDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: appDetailsRange,
        });
        if (!appDetailsResponse.data.values || !appDetailsResponse.data.values[0]) {
            console.error(`handleLeaveAction: Application not found at row ${applicationRowInSheet}.`);
            return res.status(404).send(`Application not found at row ${applicationRowInSheet}.`);
        }
        const [retrievedAppID, applicantUsername, leaveType, startDate, endDate, reasonText, currentStatus] = appDetailsResponse.data.values[0];

        if (retrievedAppID !== applicationID) {
            console.error(`handleLeaveAction: Mismatch ID. Query ID: ${applicationID}, Sheet ID: ${retrievedAppID} for row ${applicationRowInSheet}`);
            return res.status(400).send(`Application ID mismatch for row ${applicationRowInSheet}.`);
        }
        if (currentStatus === statusToSet) {
             console.log(`handleLeaveAction: Application ID ${applicationID} is already ${statusToSet}.`);
            return res.send(`Application ID ${applicationID} is already ${statusToSet}.`);
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!${statusColumn}${applicationRowInSheet}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[statusToSet]] }
        });
        console.log(`handleLeaveAction: Application ID ${applicationID} status updated to ${statusToSet}.`);

        // If rejecting an approved leave, or approving a previously rejected one, adjust leave balance.
        // This requires knowing the number of days for the application and the user's row in 'Leave Data'.
        // This part is complex and needs careful implementation if status changes are frequent.
        // For now, we assume balance is adjusted only on initial 'Pending' -> 'Approved'.
        // If action is 'reject' and it was 'Approved', or 'approve' and it was 'Rejected', balance logic needs to be added.

        if (transporter && applicantUsername) {
            const applicantEmail = await getApplicantEmail(applicantUsername);
            if (applicantEmail) {
                console.log(`handleLeaveAction: Sending status update email to applicant ${applicantUsername} at ${applicantEmail}`);
                const mailOptions = {
                    from: process.env.EMAIL_USER, to: applicantEmail,
                    subject: `Leave Application ${statusToSet} (ID: ${applicationID})`,
                    html: `<p>Your leave application (ID: ${applicationID}) has been <strong>${statusToSet.toLowerCase()}</strong>.</p>
                           <p>Details: ${leaveType || 'N/A'}, ${startDate || 'N/A'} to ${endDate || 'N/A'}. Reason: ${reasonText || 'N/A'}</p>`
                };
                transporter.sendMail(mailOptions).catch(err => console.error(`handleLeaveAction: Error sending ${statusToSet} email to applicant:`, err));
            } else {
                 console.warn(`handleLeaveAction: Could not find email for applicant ${applicantUsername} to send status update.`);
            }
        }
        res.send(`Leave application ID ${applicationID} (Row ${applicationRowInSheet}) has been ${statusToSet}.`);
    } catch (error) {
        console.error(`Error in /api/${action}-leave for row ${applicationRowInSheet}:`, error);
        res.status(500).send(`Error ${action}ing leave: ${error.message}`);
    }
}
app.get('/api/approve-leave', requireLogin, (req, res) => handleLeaveAction(req, res, 'approve')); // Add requireLogin or specific manager auth
app.get('/api/reject-leave', requireLogin, (req, res) => handleLeaveAction(req, res, 'reject'));   // Add requireLogin or specific manager auth


// Logout
app.post('/api/logout', (req, res) => {
    console.log(`Logout attempt for session: ${req.sessionID}`);
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, message: 'Logout error' });
        }
        res.clearCookie('connect.sid'); // Default session cookie name
        console.log(`Session ${req.sessionID} destroyed. Logout successful.`);
        res.json({ success: true, message: "Logout successful" });
    });
});


// --- Helper Functions for Email ---
async function getSheetDataRows(sheetName, rangeA1) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!${rangeA1}`,
    });
    if (!response.data.values || response.data.values.length <= 1) {
        console.log(`getSheetDataRows: No data rows (or only header) found in ${sheetName}!${rangeA1}`);
        return [];
    }
    return response.data.values.slice(1); // Skip header row
}

// Assumes: Column A (index 0) is Username, Column C (index 2) is Email in SHEET_NAME
async function getApplicantEmail(username) {
    console.log(`getApplicantEmail: Attempting to find email for username: ${username}`);
    try {
        const rows = await getSheetDataRows(SHEET_NAME, 'A:C'); // Fetches columns A, B, C
        if (rows.length === 0) return null;
        const userRow = rows.find(row => row && row[0] && row[0].trim().toLowerCase() === username.trim().toLowerCase());
        if (userRow && userRow[2]) {
            const email = userRow[2].trim();
            console.log(`getApplicantEmail: Email found for ${username}: ${email}`);
            return email;
        }
        console.warn(`getApplicantEmail: Email not found for username ${username}. User row:`, userRow);
        return null;
    } catch (error) {
        console.error(`getApplicantEmail: Error for ${username}:`, error);
        return null;
    }
}

// Assumes: Col A (index 0) Username, Col C (index 2) Email, Col D (index 3) Manager's Username in SHEET_NAME
async function getManagerEmail(username) {
    console.log(`getManagerEmail: Attempting to find manager's email for user: ${username}`);
    try {
        const rows = await getSheetDataRows(SHEET_NAME, 'A:D'); // Fetches A, B, C, D
        if (rows.length === 0) return null;

        const userRow = rows.find(row => row && row[0] && row[0].trim().toLowerCase() === username.trim().toLowerCase());
        if (!userRow) {
            console.warn(`getManagerEmail: User ${username} not found.`);
            return null;
        }
        const managerUsername = userRow[3] ? userRow[3].trim() : null;
        if (!managerUsername) {
            console.warn(`getManagerEmail: Manager username not set for ${username}.`);
            return null;
        }
        console.log(`getManagerEmail: Manager username for ${username} is ${managerUsername}. Looking up manager's email...`);
        const managerRow = rows.find(row => row && row[0] && row[0].trim().toLowerCase() === managerUsername.toLowerCase());
        if (managerRow && managerRow[2]) {
            const managerEmailAddress = managerRow[2].trim();
            console.log(`getManagerEmail: Email found for manager ${managerUsername}: ${managerEmailAddress}`);
            return managerEmailAddress;
        }
        console.warn(`getManagerEmail: Manager ${managerUsername} (manager of ${username}) not found or email missing.`);
        return null;
    } catch (error) {
        console.error(`getManagerEmail: Error for user ${username}:`, error);
        return null;
    }
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the app at http://localhost:${PORT} (if running locally)`);
    if (process.env.NODE_ENV === 'production') {
        console.log("Application is running in production mode.");
    } else {
        console.log("Application is running in development mode.");
    }
    console.log(`Expected SPREADSHEET_ID: ${SPREADSHEET_ID ? 'Set (' + SPREADSHEET_ID.substring(0,10) + '...)' : 'NOT SET'}`);
    console.log(`Nodemailer configured: ${transporter ? 'Yes' : 'No (EMAIL_USER/EMAIL_PASS missing?)'}`);

});
