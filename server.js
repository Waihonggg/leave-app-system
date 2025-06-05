const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 hour
}));

// Google Sheets setup
let authConfig;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
    // For production (Render)
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    authConfig = {
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    };
} else {
    // For local development
    authConfig = {
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'credentials.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    };
}

const auth = new google.auth.GoogleAuth(authConfig);

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1YPp78gjT9T_aLXau6FUVc0AxEftHnOijBDjrb3qV4rc';

// Helper function to get month column
function getMonthColumn(month) {
    const monthColumns = {
        'Jan': { leave: 'G', mc: 'H' },
        'Feb': { leave: 'I', mc: 'J' },
        'March': { leave: 'K', mc: 'L' },
        'Apr': { leave: 'M', mc: 'N' },
        'May': { leave: 'O', mc: 'P' },
        'June': { leave: 'Q', mc: 'R' },
        'July': { leave: 'S', mc: 'T' },
        'Aug': { leave: 'U', mc: 'V' },
        'Sept': { leave: 'W', mc: 'X' },
        'Oct': { leave: 'Y', mc: 'Z' },
        'Nov': { leave: 'AA', mc: 'AB' },
        'Dec': { leave: 'AC', mc: 'AD' }
    };
    return monthColumns[month];
}

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
            range: 'Sheet1!A:B',
        });
        
        const rows = response.data.values;
        const userIndex = rows.findIndex(row => 
            row[0] === username && row[1] === password
        );
        
        if (userIndex > 0) {
            req.session.user = { username, rowIndex: userIndex + 1 };
            res.json({ success: true, message: 'Login successful' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get user leave data
app.get('/api/leave-data', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `Sheet1!A${req.session.user.rowIndex}:BD${req.session.user.rowIndex}`,
        });
        
        const userData = response.data.values[0];
        
        const leaveData = {
            username: userData[0],
            carryForward: parseInt(userData[2]) || 0,
            annualLeave: parseInt(userData[3]) || 0,
            compassionateLeave: parseInt(userData[4]) || 0,
            totalLeave: parseInt(userData[5]) || 0,
            monthlyData: {
                Jan: { leave: parseInt(userData[6]) || 0, mc: parseInt(userData[7]) || 0 },
                Feb: { leave: parseInt(userData[8]) || 0, mc: parseInt(userData[9]) || 0 },
                March: { leave: parseInt(userData[10]) || 0, mc: parseInt(userData[11]) || 0 },
                Apr: { leave: parseInt(userData[12]) || 0, mc: parseInt(userData[13]) || 0 },
                May: { leave: parseInt(userData[14]) || 0, mc: parseInt(userData[15]) || 0 },
                June: { leave: parseInt(userData[16]) || 0, mc: parseInt(userData[17]) || 0 },
                July: { leave: parseInt(userData[18]) || 0, mc: parseInt(userData[19]) || 0 },
                Aug: { leave: parseInt(userData[20]) || 0, mc: parseInt(userData[21]) || 0 },
                Sept: { leave: parseInt(userData[22]) || 0, mc: parseInt(userData[23]) || 0 },
                Oct: { leave: parseInt(userData[24]) || 0, mc: parseInt(userData[25]) || 0 },
                Nov: { leave: parseInt(userData[26]) || 0, mc: parseInt(userData[27]) || 0 },
                Dec: { leave: parseInt(userData[28]) || 0, mc: parseInt(userData[29]) || 0 }
            },
            leaveTaken: parseInt(userData[30]) || 0,
            leaveBalance: parseInt(userData[31]) || 0,
            mcTaken: parseInt(userData[32]) || 0,
            mcBalance: parseInt(userData[33]) || 0
        };
        
        res.json({ success: true, data: leaveData });
    } catch (error) {
        console.error('Error fetching leave data:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Apply leave endpoint
app.post('/api/apply-leave', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    const { leaveType, startDate, endDate, reason, days } = req.body;
    const rowIndex = req.session.user.rowIndex;
    
    try {
        // Get current data
        const currentDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `Sheet1!A${rowIndex}:BD${rowIndex}`,
        });
        
        const currentData = currentDataResponse.data.values[0];
        
        // Calculate new values
        const startMonth = new Date(startDate).toLocaleString('en-US', { month: 'short' });
        const monthCol = getMonthColumn(startMonth);
        
        if (!monthCol) {
            return res.status(400).json({ success: false, message: 'Invalid month' });
        }
        
        let updates = [];
        
        if (leaveType === 'MC') {
            // Update MC columns
            const currentMC = parseInt(currentData[getColumnIndex(monthCol.mc)] || 0);
            const totalMCTaken = parseInt(currentData[32] || 0);
            const mcBalance = 14; // Assuming 14 days MC per year
            
            updates.push({
                range: `Sheet1!${monthCol.mc}${rowIndex}`,
                values: [[currentMC + days]]
            });
            
            updates.push({
                range: `Sheet1!AG${rowIndex}`,
                values: [[totalMCTaken + days]]
            });
            
            updates.push({
                range: `Sheet1!AH${rowIndex}`,
                values: [[mcBalance - (totalMCTaken + days)]]
            });
        } else {
            // Update leave columns (AL or CCL)
            const currentLeave = parseInt(currentData[getColumnIndex(monthCol.leave)] || 0);
            const totalLeaveTaken = parseInt(currentData[30] || 0);
            const totalLeave = parseInt(currentData[5] || 0);
            
            updates.push({
                range: `Sheet1!${monthCol.leave}${rowIndex}`,
                values: [[currentLeave + days]]
            });
            
            updates.push({
                range: `Sheet1!AE${rowIndex}`,
                values: [[totalLeaveTaken + days]]
            });
            
            updates.push({
                range: `Sheet1!AF${rowIndex}`,
                values: [[totalLeave - (totalLeaveTaken + days)]]
            });
        }
        
        // Batch update
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
        
        res.json({ success: true, message: 'Leave applied successfully' });
    } catch (error) {
        console.error('Error applying leave:', error);
        res.status(500).json({ success: false, message: 'Server error' });
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

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
