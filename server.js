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
            if (credentials.auth_uri) credentials.auth_uri = credentials.auth_uri.replace('https:/', 'https://');
            if (credentials.token_uri) credentials.token_uri = credentials.token_uri.replace('https:/', 'https://');
            if (credentials.auth_provider_x509_cert_url) credentials.auth_provider_x509_cert_url = credentials.auth_provider_x509_cert_url.replace('https:/', 'https://');
            if (credentials.client_x509_cert_url) credentials.client_x509_cert_url = credentials.client_x509_cert_url.replace('https:/', 'https://');
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

const SHEET_NAME = 'Leave Data';
const LEAVE_APPLICATION_SHEET = 'Leave Application';
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1YPp78gjT9T_aLXau6FUVc0AxEftHnOijBDjrb3qV4rc';

async function initializeSheet() {
    try {
        const sheetsInstance = google.sheets({ version: 'v4', auth });
        const metadata = await sheetsInstance.spreadsheets.get({
            spreadsheetId: process.env.SPREADSHEET_ID
        });
        console.log('Connected to spreadsheet:', metadata.data.properties.title);
        console.log('Available sheets:', metadata.data.sheets.map(s => s.properties.title));
        const firstSheetName = SHEET_NAME;
        try {
            const response = await sheetsInstance.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `${firstSheetName}!A1:B1`
            });
            if (!response.data.values || response.data.values.length === 0) {
                console.log('Adding headers to the sheet...');
                await sheetsInstance.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `${firstSheetName}!A1:B1`,
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: [['Username', 'Password']]
                    }
                });
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
initializeSheet().then(sheetName => {
    console.log(`Using sheet: ${sheetName}`);
}).catch(err => {
    console.error('Failed to initialize sheet:', err);
});

// Middleware to check if user is logged in
function requireLogin(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
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

// Static login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:B`,
        });
        const rows = response.data.values;
        const userIndex = rows.findIndex(row => row[0] === username && row[1] === password);
        if (userIndex > 0) {
            req.session.user = { username, rowIndex: userIndex + 1 };
            req.session.save(err => {
                if (err) res.status(500).json({ success: false, message: 'Session error' });
                else res.json({ success: true, message: 'Login successful' });
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get user leave data
app.get('/api/leave-data', requireLogin, async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${req.session.user.rowIndex}:AF${req.session.user.rowIndex}`,
        });
        const userData = response.data.values[0];
        let totalLeaveTaken = 0;
        for (let i = 8; i <= 29; i += 2) {
            totalLeaveTaken += parseInt(userData[i]) || 0;
        }
        const totalLeave = parseInt(userData[7]) || 0;
        const leaveTaken = userData[32] === undefined ? totalLeaveTaken : parseInt(userData[32]) || 0;
        const leaveBalance = userData[33] === undefined ? totalLeave - leaveTaken : parseInt(userData[33]) || 0;
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                    { range: `${SHEET_NAME}!AG${req.session.user.rowIndex}`, values: [[leaveTaken]] },
                    { range: `${SHEET_NAME}!AH${req.session.user.rowIndex}`, values: [[leaveBalance]] }
                ],
            },
        });
        const leaveApplicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:G`,
        });
        const leaveApplications = leaveApplicationsResponse.data.values
            .filter(row => row[1] === req.session.user.username)
            .map(app => ({
                id: app[0], leaveType: app[2], startDate: app[3], endDate: app[4], reason: app[5], status: app[6]
            }));
        res.json({
            success: true,
            data: {
                username: userData[0],
                carryForward: parseInt(userData[4]) || 0,
                annualLeave: parseInt(userData[5]) || 0,
                compassionateLeave: parseInt(userData[6]) || 0,
                totalLeave,
                monthlyData: {
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
                },
                leaveTaken,
                leaveBalance,
                mcTaken: parseInt(userData[34]) || 0,
                mcBalance: parseInt(userData[35]) || 0,
                applications: leaveApplications
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Apply leave endpoint
app.post('/api/apply-leave', requireLogin, async (req, res) => {
    const { leaveType, startDate, endDate, reason, days } = req.body;
    const rowIndex = req.session.user.rowIndex;
    const username = req.session.user.username;
    const startDay = new Date(startDate).getDay();
    const endDay = new Date(endDate).getDay();
    if (startDay === 0 || startDay === 6 || endDay === 0 || endDay === 6) {
        return res.status(400).json({ success: false, message: 'Leave applications cannot include weekends.' });
    }
    try {
        const leaveApplication = [
            username,
            leaveType,
            startDate,
            endDate,
            reason,
            'Pending'
        ];
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!B:G`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [leaveApplication] }
        });
        const applicationRow = appendResponse.data.updates.updatedRange.split('!')[1].replace(/[^0-9]/g, '');
        const getIDResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A:A`,
        });
        const applicationID = (getIDResponse.data.values.length);
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!A${applicationRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[applicationID]] }
        });

        const leaveDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!H${rowIndex}:AH${rowIndex}`,
        });
        const leaveData = leaveDataResponse.data.values[0];
        const totalLeave = parseInt(leaveData[0]) || 0;
        let leaveTaken = leaveData[1] === undefined ? 0 : parseInt(leaveData[1]) || 0;
        let leaveBalance = leaveData[2] === undefined ? totalLeave - leaveTaken : parseInt(leaveData[2]) || 0;
        leaveTaken += days;
        leaveBalance -= days;
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                    { range: `${SHEET_NAME}!AG${rowIndex}`, values: [[leaveTaken]] },
                    { range: `${SHEET_NAME}!AH${rowIndex}`, values: [[leaveBalance]] }
                ],
            },
        });
        const applicantEmail = await getApplicantEmail(username);
        const managerEmail = await getManagerEmail(username);
        if (!applicantEmail || !managerEmail) {
            return res.status(400).json({ success: false, message: 'Applicant or manager email not found.' });
        }
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
                <p>This is an automated notification.</p>
            `
        };
        try {
            await transporter.sendMail(mailOptionsToManager);
            console.log('Email sent to manager');
        } catch (err) {
            console.error('Error sending email to manager:', err);
        }
        res.json({ success: true, message: 'Leave application submitted successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/approve-leave', async (req, res) => {
    const applicationRow = req.query.row;
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Approved']] }
        });
        const leaveDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!B${applicationRow}:F${applicationRow}`,
        });
        const leaveDetails = leaveDetailsResponse.data.values[0];
        const username = leaveDetails[0];
        const applicantEmail = await getApplicantEmail(username);
        if (!applicantEmail) return res.status(400).send('Applicant email not found.');
        const mailOptionsToApplicant = {
            from: process.env.EMAIL_USER,
            to: applicantEmail,
            subject: 'Leave Application Approved',
            html: `<p>Your leave application has been approved.</p>
                <p><strong>Leave Type:</strong> ${leaveDetails[1]}</p>
                <p><strong>Start Date:</strong> ${leaveDetails[2]}</p>
                <p><strong>End Date:</strong> ${leaveDetails[3]}</p>
                <p><strong>Reason:</strong> ${leaveDetails[4]}</p>`
        };
        try {
            await transporter.sendMail(mailOptionsToApplicant);
            console.log('Email sent to applicant');
        } catch (err) {
            console.error('Error sending email to applicant:', err);
        }
        res.send('Leave application approved successfully.');
    } catch (error) {
        res.status(500).send('Error approving leave.');
    }
});

app.get('/api/reject-leave', async (req, res) => {
    const applicationRow = req.query.row;
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!G${applicationRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Rejected']] }
        });
        const leaveDetailsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${LEAVE_APPLICATION_SHEET}!B${applicationRow}:F${applicationRow}`,
        });
        const leaveDetails = leaveDetailsResponse.data.values[0];
        const username = leaveDetails[0];
        const applicantEmail = await getApplicantEmail(username);
        if (!applicantEmail) return res.status(400).send('Applicant email not found.');
        const mailOptionsToApplicant = {
            from: process.env.EMAIL_USER,
            to: applicantEmail,
            subject: 'Leave Application Rejected',
            html: `<p>Your leave application has been rejected.</p>
                <p><strong>Leave Type:</strong> ${leaveDetails[1]}</p>
                <p><strong>Start Date:</strong> ${leaveDetails[2]}</p>
                <p><strong>End Date:</strong> ${leaveDetails[3]}</p>
                <p><strong>Reason:</strong> ${leaveDetails[4]}</p>`
        };
        try {
            await transporter.sendMail(mailOptionsToApplicant);
            console.log('Email sent to applicant');
        } catch (err) {
            console.error('Error sending email to applicant:', err);
        }
        res.send('Leave application rejected successfully.');
    } catch (error) {
        res.status(500).send('Error rejecting leave.');
    }
});

// Function to get applicant's email from Leave Data sheet
async function getApplicantEmail(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:C`,
        });
        const rows = response.data.values;
        const userRow = rows.find(row => row[0] === username);
        return userRow && userRow[2] ? userRow[2] : null;
    } catch (error) {
        return null;
    }
}

// Function to get manager's email from Leave Data sheet
async function getManagerEmail(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:D`,
        });
        const rows = response.data.values;
        const userRow = rows.find(row => row[0] === username);
        if (!userRow || !userRow[3]) return null;
        const managerUsername = userRow[3];
        const managerRow = rows.find(row => row[0] === managerUsername);
        return managerRow && managerRow[2] ? managerRow[2] : null;
    } catch (error) {
        return null;
    }
}

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: 'Logout error' });
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
