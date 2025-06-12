const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.set('trust proxy', 1);

// Session Configuration
let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-very-secure-and-long-session-secret-key-replace-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
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
const SHEET_NAME = 'Leave Data';
const LEAVE_APPLICATION_SHEET = 'Leave Application';

if (!SPREADSHEET_ID) {
    console.error("FATAL ERROR: SPREADSHEET_ID environment variable is not set.");
    process.exit(1);
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
        initializeSheetHeaders();
    }).catch(err => {
        console.error('Google Sheets authentication failed:', err.message);
    });
} catch (error) {
    console.error('FATAL ERROR setting up Google Auth:', error.message);
    process.exit(1);
}

const sheets = google.sheets({ version: 'v4', auth });

async function initializeSheetHeaders() {
    try {
        // Check/initialize 'Leave Data' sheet
        const leaveDataHeaders = ['Username', 'Password', 'Email', 'Manager Username', 'Carry forward 2024', '2025 AL', 'CCL', 'Total 2025', 'Jan Leave', 'Jan MC', 'Feb Leave', 'Feb MC', 'Mar Leave', 'Mar MC', 'Apr Leave', 'Apr MC', 'May Leave', 'May MC', 'Jun Leave', 'Jun MC', 'Jul Leave', 'Jul MC', 'Aug Leave', 'Aug MC', 'Sep Leave', 'Sep MC', 'Oct Leave', 'Oct MC', 'Nov Leave', 'Nov MC', 'Dec Leave', 'Dec MC', 'Leave Taken', 'Leave Balance', 'MC Taken', 'MC Balance', 'WFH count'];
        const userSheetCheck = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:${String.fromCharCode(64 + leaveDataHeaders.length)}1`
        });

        let headersMatch = userSheetCheck.data.values && userSheetCheck.data.values[0] && userSheetCheck.data.values[0].length === leaveDataHeaders.length;

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
        const appSheetHeaders = ['ID', 'Username', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Reason', 'Status'];
        const appSheetCheck = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A1:H1`
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
            return res.redirect('/');
        }
    }
}

// Nodemailer setup
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    console.log("Nodemailer configured with EMAIL_USER and EMAIL_PASS.");
} else {
    console.warn("WARN: EMAIL_USER or EMAIL_PASS environment variables are not set. Email notifications will fail.");
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
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:B`,
        });
        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
             console.warn('Login failed. User data sheet might be empty or only has headers.');
             return res.status(401).json({ success: false, message: 'Login failed. No user data found.' });
        }
        
        let userFound = null;
        let userIndexInSheet = -1;

        for (let i = 1; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && rows[i][1] &&
                rows[i][0].trim().toLowerCase() === username.trim().toLowerCase() &&
                rows[i][1] === password) {
                userFound = { username: rows[i][0].trim() };
                userIndexInSheet = i;
                break;
            }
        }

        if (userFound) {
            req.session.user = {
                username: userFound.username,
                rowIndex: userIndexInSheet + 1
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
    const userRowInSheet = req.session.user.rowIndex;
    console.log(`Fetching leave data for user: ${username}, sheet row: ${userRowInSheet}`);

    try {
        const userDataRange = `${SHEET_NAME}!A${userRowInSheet}:AK${userRowInSheet}`;
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
            range: `${LEAVE_APPLICATION_SHEET}!A:H`,
        });
        
        let userApplications = [];
        if (leaveApplicationsResponse.data.values && leaveApplicationsResponse.data.values.length > 1) {
            userApplications = leaveApplicationsResponse.data.values.slice(1)
                .filter(row => row && row.length >= 2 && row[1] && row[1].trim().toLowerCase() === username.toLowerCase())
                .map(app => ({
                    id: app[0] || 'N/A',
                    username: app[1] || 'N/A',
                    leaveType: app[2] || 'N/A',
                    startDate: app[3] || 'N/A',
                    endDate: app[4] || 'N/A',
                    days: app[5] || 'N/A',
                    reason: app[6] || 'No reason provided',
                    status: app[7] || 'Unknown'
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
                username: userData[0] || username,
                carryForward: parseInt(userData[4]) || 0,
                annualLeave: parseInt(userData[5]) || 0,
                compassionateLeave: parseInt(userData[6]) || 0,
                totalLeave: parseInt(userData[7]) || 0,
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
    const userRowIndexInLeaveDataSheet = req.session.user.rowIndex;

    if (!leaveType || !startDate || !endDate || !days) {
        console.error('/api/apply-leave: Validation failed - Missing required fields.');
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required fields for leave application.' 
        });
    }

    try {
        // Get next application ID
        let nextId = 1;
        const existingApplications = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:A`
        });

        if (existingApplications.data.values) {
            const ids = existingApplications.data.values
                .slice(1)
                .map(row => parseInt(row[0]))
                .filter(id => !isNaN(id));
            if (ids.length > 0) nextId = Math.max(0, ...ids) + 1;
        }

        // Add to Leave Application sheet with Pending status
        const leaveApplicationRowData = [
            nextId.toString(),        // ID
            username,                 // Username
            leaveType,               // Leave Type
            startDate,               // Start Date
            endDate,                 // End Date
            days.toString(),         // Days
            reason || '',            // Reason
            'Pending'                // Status always starts as Pending
        ];

        console.log('/api/apply-leave: Attempting to append to LEAVE_APPLICATION_SHEET:', JSON.stringify(leaveApplicationRowData));
        
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:H`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [leaveApplicationRowData] }
        });

        console.log('/api/apply-leave: Append to sheet successful.');
        
        // Send email to manager
        if (transporter) {
            const managerEmail = await getManagerEmail(username);
            if (managerEmail) {
                // Get the row number of the newly added application
                const newApplicationRowNumber = parseInt(appendResponse.data.updates.updatedRange.split('!A')[1].split(':')[0]);
                
                // Get the base URL for the application
                const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
                
                const managerMailOptions = {
                    from: process.env.EMAIL_USER,
                    to: managerEmail,
                    subject: `Leave Application - ${username} (ID: ${nextId})`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h3 style="color: #333;">New Leave Application</h3>
                            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                                <p><strong>Employee:</strong> ${username}</p>
                                <p><strong>Leave Type:</strong> ${leaveType}</p>
                                <p><strong>Start Date:</strong> ${startDate}</p>
                                <p><strong>End Date:</strong> ${endDate}</p>
                                <p><strong>Number of Days:</strong> ${days}</p>
                                <p><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
                                <p><strong>Status:</strong> <span style="color: #ff9800; font-weight: bold;">Pending</span></p>
                            </div>
                            
                            <div style="margin: 30px 0; text-align: center;">
                                <a href="${baseUrl}/api/approve-leave?row=${newApplicationRowNumber}&id=${nextId}" 
                                   style="display: inline-block; padding: 12px 30px; margin: 0 10px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                    APPROVE
                                </a>
                                <a href="${baseUrl}/api/reject-leave?row=${newApplicationRowNumber}&id=${nextId}" 
                                   style="display: inline-block; padding: 12px 30px; margin: 0 10px; background-color: #f44336; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                    REJECT
                                </a>
                            </div>
                            
                            <p style="color: #666; font-size: 12px; margin-top: 30px;">
                                <em>Note: You may need to be logged in to the Leave Application System to approve/reject this request.</em>
                            </p>
                        </div>
                    `
                };
                
                try {
                    await transporter.sendMail(managerMailOptions);
                    console.log(`Email sent to manager: ${managerEmail}`);
                } catch (emailError) {
                    console.error('Error sending email to manager:', emailError);
                }
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Leave application submitted successfully. Status: Pending approval', 
            applicationId: nextId.toString() 
        });

    } catch (error) {
        console.error('--- ERROR in /api/apply-leave ---:', error.message, error.stack);
        res.status(500).json({ 
            success: false, 
            message: `Server error submitting leave: ${error.message}` 
        });
    }
});

// Approve/Reject leave application - Updated to handle GET requests from email
app.get('/api/:action(approve|reject)-leave', requireLogin, async (req, res) => {
    const action = req.params.action;
    const { row: applicationRowInSheet, id: applicationID } = req.query;

    if (!applicationRowInSheet || isNaN(parseInt(applicationRowInSheet)) || !applicationID) {
        return res.status(400).send(`
            <html>
                <head><title>Error</title></head>
                <body>
                    <h3>Error: Valid application row number and ID are required.</h3>
                    <p><a href="/dashboard.html">Go to Dashboard</a></p>
                </body>
            </html>
        `);
    }

    const statusToSet = action === 'approve' ? 'Approved' : 'Rejected';
    const statusColumn = 'H'; // Status column in sheet

    try {
        // Get application details
        const appDetailsRange = `${LEAVE_APPLICATION_SHEET}!A${applicationRowInSheet}:H${applicationRowInSheet}`;
        const appDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: appDetailsRange,
        });

        if (!appDetailsResponse.data.values || !appDetailsResponse.data.values[0]) {
            return res.status(404).send(`
                <html>
                    <head><title>Not Found</title></head>
                    <body>
                        <h3>Application not found at row ${applicationRowInSheet}.</h3>
                        <p><a href="/dashboard.html">Go to Dashboard</a></p>
                    </body>
                </html>
            `);
        }

        const [
            retrievedAppID, 
            applicantUsername, 
            leaveType, 
            startDate, 
            endDate, 
            daysStr,
            reasonText, 
            currentStatus
        ] = appDetailsResponse.data.values[0];

        if (retrievedAppID !== applicationID) {
            return res.status(400).send(`
                <html>
                    <head><title>Error</title></head>
                    <body>
                        <h3>Application ID mismatch for row ${applicationRowInSheet}.</h3>
                        <p><a href="/dashboard.html">Go to Dashboard</a></p>
                    </body>
                </html>
            `);
        }

        if (currentStatus === statusToSet) {
            return res.send(`
                <html>
                    <head><title>Already Processed</title></head>
                    <body>
                        <h3>Application ID ${applicationID} is already ${statusToSet}.</h3>
                        <p><a href="/dashboard.html">Go to Dashboard</a></p>
                    </body>
                </html>
            `);
        }

        // Update application status
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!${statusColumn}${applicationRowInSheet}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[statusToSet]] }
        });

        // If approved and was previously pending, update leave balance
        if (action === 'approve' && currentStatus === 'Pending') {
            // Get user's row in Leave Data sheet
            const userDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A:AK`,
            });

            const userRowIndex = userDataResponse.data.values.findIndex(row => row[0] === applicantUsername);
            if (userRowIndex === -1) {
                throw new Error(`User ${applicantUsername} not found in Leave Data sheet`);
            }

            const leaveDays = parseFloat(daysStr) || 0;
            
            // Determine which month to update based on start date
            const startDt = new Date(startDate);
            const monthIndex = startDt.getMonth(); // 0-11
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            
            // Column indices for monthly leave/MC data
            let columnIndex;
            if (leaveType === 'MC') {
                columnIndex = 9 + (monthIndex * 2); // MC columns
            } else {
                columnIndex = 8 + (monthIndex * 2); // Leave columns
            }
            
            // Get current value
            const currentMonthValue = parseFloat(userDataResponse.data.values[userRowIndex][columnIndex]) || 0;
            const newMonthValue = currentMonthValue + leaveDays;
            
            // Update the specific month column
            const columnLetter = String.fromCharCode(65 + columnIndex); // Convert to letter
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!${columnLetter}${userRowIndex + 1}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[newMonthValue]] }
            });
            
            console.log(`Updated ${monthNames[monthIndex]} ${leaveType === 'MC' ? 'MC' : 'Leave'} for ${applicantUsername}: ${currentMonthValue} -> ${newMonthValue}`);
        }

        // Send email notification to applicant
        if (transporter && applicantUsername) {
            const applicantEmail = await getApplicantEmail(applicantUsername);
            if (applicantEmail) {
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: applicantEmail,
                    subject: `Leave Application ${statusToSet} (ID: ${applicationID})`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h3 style="color: #333;">Leave Application ${statusToSet}</h3>
                            <p>Your leave application (ID: ${applicationID}) has been <strong style="color: ${action === 'approve' ? '#4CAF50' : '#f44336'};">${statusToSet.toLowerCase()}</strong>.</p>
                            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                                <p><strong>Leave Type:</strong> ${leaveType || 'N/A'}</p>
                                <p><strong>Period:</strong> ${startDate || 'N/A'} to ${endDate || 'N/A'}</p>
                                <p><strong>Number of days:</strong> ${daysStr || 'N/A'}</p>
                                <p><strong>Reason:</strong> ${reasonText || 'N/A'}</p>
                            </div>
                        </div>
                    `
                };
                await transporter.sendMail(mailOptions);
            }
        }

        // Return HTML response for browser
        res.send(`
            <html>
                <head>
                    <title>Leave ${statusToSet}</title>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                        .success { color: #4CAF50; }
                        .rejected { color: #f44336; }
                        .info { background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; }
                    </style>
                </head>
                <body>
                    <h2 class="${action === 'approve' ? 'success' : 'rejected'}">Leave Application ${statusToSet}</h2>
                    <div class="info">
                        <p><strong>Application ID:</strong> ${applicationID}</p>
                        <p><strong>Employee:</strong> ${applicantUsername}</p>
                        <p><strong>Leave Type:</strong> ${leaveType}</p>
                        <p><strong>Period:</strong> ${startDate} to ${endDate}</p>
                        <p><strong>Days:</strong> ${daysStr}</p>
                        <p><strong>Status:</strong> ${statusToSet}</p>
                    </div>
                    <p>An email notification has been sent to the applicant.</p>
                    <p><a href="/dashboard.html">Go to Dashboard</a></p>
                </body>
            </html>
        `);

    } catch (error) {
        console.error(`Error in /api/${action}-leave:`, error);
        res.status(500).send(`
            <html>
                <head><title>Error</title></head>
                <body>
                    <h3>Error ${action}ing leave: ${error.message}</h3>
                    <p><a href="/dashboard.html">Go to Dashboard</a></p>
                </body>
            </html>
        `);
    }
});

// Keep the POST endpoint for API compatibility
app.post('/api/:action(approve|reject)-leave', requireLogin, async (req, res) => {
    // Call the GET handler with the same logic
    return app._router.handle(Object.assign(req, { method: 'GET' }), res);
});

// Logout
app.post('/api/logout', (req, res) => {
    console.log(`Logout attempt for session: ${req.sessionID}`);
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, message: 'Logout error' });
        }
        res.clearCookie('connect.sid');
        console.log(`Session destroyed. Logout successful.`);
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
    return response.data.values.slice(1);
}

// Get applicant email
async function getApplicantEmail(username) {
    console.log(`getApplicantEmail: Attempting to find email for username: ${username}`);
    try {
        const rows = await getSheetDataRows(SHEET_NAME, 'A:C');
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

// Get manager email
async function getManagerEmail(username) {
    console.log(`getManagerEmail: Attempting to find manager's email for user: ${username}`);
    try {
        const rows = await getSheetDataRows(SHEET_NAME, 'A:D');
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
