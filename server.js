const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer'); // Import nodemailer
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Trust proxy
app.set('trust proxy', 1) // trust first proxy

// Session configuration - IMPORTANT: Use a database-backed store in production!
let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000, // 1 hour
        httpOnly: true,
    }
};

if (process.env.NODE_ENV === 'production') {
    sessionConfig.cookie.secure = true; // Serve secure cookies
    sessionConfig.cookie.sameSite = 'lax'; // or 'none' if needed

    // TODO: Implement a database-backed session store (e.g., Redis, MongoDB) here
    // For example:
    // const RedisStore = require('connect-redis')(session);
    // const redisClient = require('redis').createClient({ /* Redis config */ });
    // sessionConfig.store = new RedisStore({ client: redisClient });
} else {
    sessionConfig.cookie.secure = false; // Allow non-HTTPS cookies in development
    sessionConfig.cookie.sameSite = 'lax';
}

app.use(session(sessionConfig));

// Google Sheets setup
let auth;
try {
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        // For production (Render) - use credentials from environment variable
        console.log('Using Google credentials from environment variable');
        let credentials;
        try {
            credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            // Fix any potential URL issues
            if (credentials.auth_uri) credentials.auth_uri = credentials.auth_uri.replace('https:/', 'https://');
            if (credentials.token_uri) credentials.token_uri = credentials.token_uri.replace('https:/', 'https://');
            if (credentials.auth_provider_x509_cert_url) credentials.auth_provider_x509_cert_url = credentials.auth_provider_x509_cert_url.replace('https:/', 'https://');
            if (credentials.client_x509_cert_url) credentials.client_x509_cert_url = credentials.client_x509_cert_url.replace('https:/', 'https://');
        } catch (parseError) {
            console.error('Error parsing GOOGLE_CREDENTIALS_JSON:', parseError);
            throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
        }

        auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // Use file path from GOOGLE_APPLICATION_CREDENTIALS
        console.log('Using Google credentials from file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else if (fs.existsSync('credentials.json')) {
        // Default to local credentials.json file
        console.log('Using Google credentials from local credentials.json file');
        auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    } else {
        throw new Error('No Google credentials found. Please set GOOGLE_CREDENTIALS_JSON environment variable or provide credentials.json file.');
    }

    // Test the authentication
    auth.getClient().then(() => {
        console.log('Google Sheets authentication successful');
    }).catch(err => {
        console.error('Google Sheets authentication failed:', err);
    });
} catch (error) {
    console.error('Error setting up Google Auth:', error);
    process.exit(1);
}

// Sheet names based on user input
const SHEET_NAME = 'Leave Data';
const LEAVE_APPLICATION_SHEET = 'Leave Application';
const MASTER_CALENDAR_SHEET = 'Master Calendar';

// Create sheets instance globally
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1YPp78gjT9T_aLXau6FUVc0AxEftHnOijBDjrb3qV4rc';

// Initialize Google Sheets (create sheet if needed)
async function initializeSheet() {
    try {
        const sheetsInstance = google.sheets({ version: 'v4', auth });

        // First, try to get spreadsheet metadata
        const metadata = await sheetsInstance.spreadsheets.get({
            spreadsheetId: process.env.SPREADSHEET_ID
        });

        console.log('Connected to spreadsheet:', metadata.data.properties.title);
        console.log('Available sheets:', metadata.data.sheets.map(s => s.properties.title));

        // Check if we have any sheets with data
        const firstSheetName = SHEET_NAME;

        // Try to read the first row to check if headers exist
        try {
            const response = await sheetsInstance.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `${firstSheetName}!A1:B1`
            });

            if (!response.data.values || response.data.values.length === 0) {
                // No headers, let's add them
                console.log('Adding headers to the sheet...');
                await sheetsInstance.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `${firstSheetName}!A1:B1`,
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: [['Username', 'Password']]
                    }
                });

                // Add a default admin user
                await sheetsInstance.spreadsheets.values.append({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `${firstSheetName}!A:B`,
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: [['admin', await bcrypt.hash('admin123', 10)]]
                    }
                });

                console.log('Sheet initialized with headers and default admin user (username: admin, password: admin123)');
            }
        } catch (err) {
            console.log('Sheet seems empty, initializing...');
        }

        return firstSheetName;
    } catch (error) {
        console.error('Error initializing sheet:', error);
        throw error;
    }
}

// Initialize sheet on startup
initializeSheet().then(sheetName => {
    console.log(`Using sheet: ${sheetName}`);
}).catch(err => {
    console.error('Failed to initialize sheet:', err);
});

// Helper function to get month column
function getMonthColumn(month) {
    const monthColumns = {
        'Jan': { leave: 'I', mc: 'J' },
        'Feb': { leave: 'K', mc: 'L' },
        'March': { leave: 'M', mc: 'N' },
        'Apr': { leave: 'O', mc: 'P' },
        'May': { leave: 'Q', mc: 'R' },
        'June': { leave: 'S', mc: 'T' },
        'July': { leave: 'U', mc: 'V' },
        'Aug': { leave: 'W', mc: 'X' },
        'Sept': { leave: 'Y', mc: 'Z' },
        'Oct': { leave: 'AA', mc: 'AB' },
        'Nov': { leave: 'AC', mc: 'AD' },
        'Dec': { leave: 'AE', mc: 'AF' }
    };
    return monthColumns[month];
}

// Middleware to check if user is logged in
function requireLogin(req, res, next) {
    if (req.session && req.session.user) {
        // Session exists, proceed
        console.log("User is authenticated");
        next();
    } else {
        // No session, redirect to login
        console.log("Unauthorized access attempt");
        return res.status(401).json({ success: false, message: 'Not authenticated' });  // Or redirect
    }
}

// Configure Nodemailer (replace with your email provider details)
const transporter = nodemailer.createTransport({
    service: 'gmail', // e.g., 'gmail', 'Outlook'
    auth: {
        user: process.env.EMAIL_USER, // Your email address
        pass: process.env.EMAIL_PASS  // Your email password or app password
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:B`,
        });

        const rows = response.data.values;
        const userIndex = rows.findIndex(row =>
            row[0] === username && row[1] === password
        );

        if (userIndex > 0) {
            req.session.user = { username, rowIndex: userIndex + 1 };
            req.session.save(err => {  // Add this
                if (err) {
                    console.error("Error saving session:", err);
                    return res.status(500).json({ success: false, message: 'Session error' }); // Send error response
                } else {
                    console.log("Session saved successfully");
                    res.json({ success: true, message: 'Login successful' });
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get user leave data
app.get('/api/leave-data', requireLogin, async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${req.session.user.rowIndex}:AK${req.session.user.rowIndex}`,
        });

        const userData = response.data.values[0];

        const leaveData = {
            username: userData[0],
            carryForward: parseInt(userData[4]) || 0,  // E
            annualLeave: parseInt(userData[5]) || 0,   // F
            compassionateLeave: parseInt(userData[6]) || 0,  // G
            totalLeave: parseInt(userData[7]) || 0,   // H
            monthlyData: {
                Jan: { leave: parseInt(userData[8]) || 0, mc: parseInt(userData[9]) || 0 },   // I, J
                Feb: { leave: parseInt(userData[10]) || 0, mc: parseInt(userData[11]) || 0 },  // K, L
                March: { leave: parseInt(userData[12]) || 0, mc: parseInt(userData[13]) || 0 }, // M, N
                Apr: { leave: parseInt(userData[14]) || 0, mc: parseInt(userData[15]) || 0 }, // O, P
                May: { leave: parseInt(userData[16]) || 0, mc: parseInt(userData[17]) || 0 }, // Q, R
                June: { leave: parseInt(userData[18]) || 0, mc: parseInt(userData[19]) || 0 }, // S, T
                July: { leave: parseInt(userData[20]) || 0, mc: parseInt(userData[21]) || 0 }, // U, V
                Aug: { leave: parseInt(userData[22]) || 0, mc: parseInt(userData[23]) || 0 }, // W, X
                Sept: { leave: parseInt(userData[24]) || 0, mc: parseInt(userData[25]) || 0 }, // Y, Z
                Oct: { leave: parseInt(userData[26]) || 0, mc: parseInt(userData[27]) || 0 }, // AA, AB
                Nov: { leave: parseInt(userData[28]) || 0, mc: parseInt(userData[29]) || 0 }, // AC, AD
                Dec: { leave: parseInt(userData[30]) || 0, mc: parseInt(userData[31]) || 0 }  // AE, AF
            },
            leaveTaken: parseInt(userData[32]) || 0,  // AG
            leaveBalance: parseInt(userData[33]) || 0, // AH
            mcTaken: parseInt(userData[34]) || 0,     // AI
            mcBalance: parseInt(userData[35]) || 0,    // AJ
        };

        // Fetch leave application statuses
        const leaveApplicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`,
        });

        const leaveApplications = leaveApplicationsResponse.data.values.filter(row => row[1] === req.session.user.username);

        leaveData.applications = leaveApplications.map(app => ({
            id: app[0],
            leaveType: app[2],
            startDate: app[3],
            endDate: app[4],
            reason: app[5],
            status: app[6]
        }));

        res.json({ success: true, data: leaveData });
    } catch (error) {
        console.error('Error fetching leave data:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Apply leave endpoint
app.post('/api/apply-leave', requireLogin, async (req, res) => {
    const { leaveType, startDate, endDate, reason, days } = req.body;
    const rowIndex = req.session.user.rowIndex;
    const username = req.session.user.username; // Get username from session

    try {
        // 1. Add leave application to 'Leave Application' sheet
        const leaveApplication = [
            username,
            leaveType,
            startDate,
            endDate,
            reason,
            'Pending' // Initial status
        ];

        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!B:G`, // Append to the end of the sheet, start from column B
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [leaveApplication]
            }
        });

        const applicationRow = appendResponse.data.updates.updatedRange.split('!')[1].replace(/[^0-9]/g, ''); // extract the added row number

        //Get the ID for leave application
         const getIDResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:A`,
        });

        const applicationID = (getIDResponse.data.values.length);

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A${applicationRow}`, // Update ID column
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[applicationID]]
            }
        });
         // 2. Get current leave data from 'Leave Data' sheet
        const leaveDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!AG${rowIndex}:AJ${rowIndex}`, // Get leaveTaken, leaveBalance, mcTaken, mcBalance
        });

        const leaveData = leaveDataResponse.data.values[0];

        let leaveTaken = parseInt(leaveData[0]) || 0;
        let leaveBalance = parseInt(leaveData[1]) || 0;
        let mcTaken = parseInt(leaveData[2]) || 0;
        let mcBalance = parseInt(leaveData[3]) || 0;

        // 3. Update leave data based on leave type
        if (leaveType === 'MC') {
            mcTaken += days;
            mcBalance -= days;
        } else {
            leaveTaken += days;
            leaveBalance -= days;
        }

        // 4. Update 'Leave Data' sheet with new values
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                    {
                        range: `${SHEET_NAME}!AG${rowIndex}`,
                        values: [[leaveTaken]],
                    },
                    {
                        range: `${SHEET_NAME}!AH${rowIndex}`,
                        values: [[leaveBalance]],
                    },
                    {
                        range: `${SHEET_NAME}!AI${rowIndex}`,
                        values: [[mcTaken]],
                    },
                    {
                        range: `${SHEET_NAME}!AJ${rowIndex}`,
                        values: [[mcBalance]],
                    },
                ],
            },
        });
        // 5. Get applicant and manager emails
        const applicantEmail = await getApplicantEmail(username);
        const managerEmail = await getManagerEmail(username);

        if (!applicantEmail || !managerEmail) {
            return res.status(400).json({ success: false, message: 'Applicant or manager email not found.' });
        }
        // 6. Send email to manager
        const mailOptionsToManager = {
            from: process.env.EMAIL_USER,
            to: managerEmail,
            subject: 'Leave Application for Approval',
            html: `
                <p>A leave application has been submitted by ${username}.</p>
                <p><strong>Leave Type:</strong> ${leaveType}</p>
                <p><strong>Start Date:</strong> ${startDate}</p>
                <p><strong>End Date:</strong> ${endDate}</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p><a href="[YOUR_BASE_URL]/api/approve-leave?row=${applicationRow}">Approve</a> | <a href="[YOUR_BASE_URL]/api/reject-leave?row=${applicationRow}">Reject</a></p>
            `
        };

        transporter.sendMail(mailOptionsToManager, (error, info) => {
            if (error) {
                console.error('Error sending email to manager:', error);
            } else {
                console.log('Email sent to manager:', info.response);
            }
        });

        res.json({ success: true, message: 'Leave application submitted successfully.' });

    } catch (error) {
        console.error('Error applying leave:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Approve leave endpoint (called by manager via email link)
app.get('/api/approve-leave', async (req, res) => {
    const applicationRow = req.query.row;

    try {
        // 1. Update 'Leave Application' sheet
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`, // Update status column
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Approved']]
            }
        });

        // 2. Get leave application details
        const leaveDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!B${applicationRow}:F${applicationRow}`,
        });

        const leaveDetails = leaveDetailsResponse.data.values[0];
        const username = leaveDetails[0];
        const leaveType = leaveDetails[1];
        const startDate = leaveDetails[2];
        const endDate = leaveDetails[3];
        const reason = leaveDetails[4];

        // 3. Get applicant email
        const applicantEmail = await getApplicantEmail(username);

        if (!applicantEmail) {
            return res.status(400).send('Applicant email not found.');
        }
        // 4. Send email to applicant
        const mailOptionsToApplicant = {
            from: process.env.EMAIL_USER,
            to: applicantEmail,
            subject: 'Leave Application Approved',
            html: `<p>Your leave application has been approved.</p>
                   <p><strong>Leave Type:</strong> ${leaveType}</p>
                   <p><strong>Start Date:</strong> ${startDate}</p>
                   <p><strong>End Date:</strong> ${endDate}</p>
                   <p><strong>Reason:</strong> ${reason}</p>`
        };

        transporter.sendMail(mailOptionsToApplicant, (error, info) => {
            if (error) {
                console.error('Error sending email to applicant:', error);
            } else {
                console.log('Email sent to applicant:', info.response);
            }
        });

        res.send('Leave application approved successfully.'); // Or redirect to a confirmation page

    } catch (error) {
        console.error('Error approving leave:', error);
        res.status(500).send('Error approving leave.');
    }
});

// Reject leave endpoint (called by manager via email link)
app.get('/api/reject-leave', async (req, res) => {
    const applicationRow = req.query.row;

    try {
        // 1. Update 'Leave Application' sheet
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`, // Update status column
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Rejected']]
            }
        });

        // 2. Get leave application details
        const leaveDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!B${applicationRow}:F${applicationRow}`,
        });

       const leaveDetails = leaveDetailsResponse.data.values[0];
        const username = leaveDetails[0];
        const leaveType = leaveDetails[1];
        const startDate = leaveDetails[2];
        const endDate = leaveDetails[3];
        const reason = leaveDetails[4];

         // 3. Get applicant email
        const applicantEmail = await getApplicantEmail(username);

        if (!applicantEmail) {
            return res.status(400).send('Applicant email not found.');
        }
        // 4. Send email to applicant
        const mailOptionsToApplicant = {
            from: process.env.EMAIL_USER,
            to: applicantEmail,
            subject: 'Leave Application Rejected',
            html: `<p>Your leave application has been rejected.</p>
                   <p><strong>Leave Type:</strong> ${leaveType}</p>
                   <p><strong>Start Date:</strong> ${startDate}</p>
                   <p><strong>End Date:</strong> ${endDate}</p>
                   <p><strong>Reason:</strong> ${reason}</p>`
        };

        transporter.sendMail(mailOptionsToApplicant, (error, info) => {
            if (error) {
                console.error('Error sending email to applicant:', error);
            } else {
                console.log('Email sent to applicant:', info.response);
            }
        });

        res.send('Leave application rejected successfully.'); // Or redirect to a confirmation page

    } catch (error) {
        console.error('Error rejecting leave:', error);
        res.status(500).send('Error rejecting leave.');
    }
});

// Helper function to get column index
function getColumnIndex(column) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let index = 0;

    for (let i = 0; i < column.length; i++) {
        index = index * 26 + alphabet.indexOf(column[i]) + 1;
    }

    return index - 1;
}

// Function to get applicant's email from Leave Data sheet
async function getApplicantEmail(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:C`, // Assuming email is in column C
        });

        const rows = response.data.values;
        const userRow = rows.find(row => row[0] === username); // Find the row with the matching username

        if (userRow && userRow[2]) {
            return userRow[2]; // Return the email from column C
        } else {
            console.log('Applicant email not found for username:', username);
            return null;
        }
    } catch (error) {
        console.error('Error getting applicant email:', error);
        return null;
    }
}

// Function to get manager's email from Leave Data sheet
async function getManagerEmail(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:D`, // Assuming manager's username is in column D
        });

        const rows = response.data.values;
        const userRow = rows.find(row => row[0] === username); // Find the row with the matching username

        if (!userRow || !userRow[3]) {
            console.log('Manager username not found for username:', username);
            return null;
        }

        const managerUsername = userRow[3];

        // Find the manager's email based on their username
        const managerRow = rows.find(row => row[0] === managerUsername);

        if (managerRow && managerRow[2]) {
            return managerRow[2]; // Return the manager's email from column C
        } else {
            console.log('Manager email not found for manager username:', managerUsername);
            return null;
        }
    } catch (error) {
        console.error('Error getting manager email:', error);
        return null;
    }
}
// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).json({ success: false, message: 'Logout error' });
        }
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
