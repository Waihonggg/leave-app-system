// Apply leave functionality
let currentLeaveData = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const username = localStorage.getItem('username');
    if (!username) {
        window.location.href = 'login.html';
        return;
    }
    
    // Load current leave data
    await loadCurrentBalances();
    
    // Setup form handlers
    setupFormHandlers();
    
    // Setup logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        localStorage.removeItem('username');
        window.location.href = 'login.html';
    });
});

async function loadCurrentBalances() {
    try {
        const response = await fetch('/api/leave-data');
        
        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Failed to load data');
        }
        
        const result = await response.json();
        
        if (result.success) {
            currentLeaveData = result.data;
            document.getElementById('currentBalance').textContent = result.data.leaveBalance;
            document.getElementById('currentMCBalance').textContent = result.data.mcBalance;
        }
    } catch (error) {
        console.error('Error loading balances:', error);
    }
}

function setupFormHandlers() {
    const leaveForm = document.getElementById('leaveForm');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const leaveTypeSelect = document.getElementById('leaveType');
    const daysInput = document.getElementById('days');
    
    // Set minimum date to today
    const today = new Date().toISOString().split('T')[0];
    startDateInput.min = today;
    endDateInput.min = today;
    
    // Calculate days and check for weekends
    function calculateDays() {
        const startDate = new Date(startDateInput.value);
        const endDate = new Date(endDateInput.value);
        
        if (startDate && endDate && endDate >= startDate) {
            let totalDays = 0;
            const currentDate = new Date(startDate);
            
            while (currentDate <= endDate) {
                // Check if it's not a weekend (0 = Sunday, 6 = Saturday)
                const dayOfWeek = currentDate.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                    totalDays++;
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            if (totalDays === 0) {
                showMessage('Selected dates fall entirely on weekends. Please select workdays.', 'error');
                daysInput.value = '';
                return;
            }
            
            daysInput.value = totalDays;
        } else {
            daysInput.value = '';
        }
    }
    
    // Validate dates on change
    function validateDates() {
        if (startDateInput.value) {
            const startDate = new Date(startDateInput.value);
            const startDay = startDate.getDay();
            
            if (startDay === 0 || startDay === 6) {
                showMessage('Start date cannot be on a weekend. Please select a weekday.', 'error');
                startDateInput.value = '';
                daysInput.value = '';
                return false;
            }
        }
        
        if (endDateInput.value) {
            const endDate = new Date(endDateInput.value);
            const endDay = endDate.getDay();
            
            if (endDay === 0 || endDay === 6) {
                showMessage('End date cannot be on a weekend. Please select a weekday.', 'error');
                endDateInput.value = '';
                daysInput.value = '';
                return false;
            }
        }
        
        return true;
    }
    
    startDateInput.addEventListener('change', () => {
        if (validateDates()) {
            endDateInput.min = startDateInput.value;
            calculateDays();
        }
    });
    
    endDateInput.addEventListener('change', () => {
        if (validateDates()) {
            calculateDays();
        }
    });
    
    // Show/hide MC balance based on leave type
    leaveTypeSelect.addEventListener('change', () => {
        const mcBalanceInfo = document.getElementById('mcBalanceInfo');
        if (leaveTypeSelect.value === 'MC') {
            mcBalanceInfo.style.display = 'block';
        } else {
            mcBalanceInfo.style.display = 'none';
        }
    });
    
    // Handle form submission
    leaveForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!startDateInput.value || !endDateInput.value) {
            showMessage('Please select valid dates', 'error');
            return;
        }

        // Final weekend validation before submission
        const startDate = new Date(startDateInput.value);
        const endDate = new Date(endDateInput.value);
        
        if (startDate.getDay() === 0 || startDate.getDay() === 6) {
            showMessage('Cannot apply leave starting on a weekend. Please select a weekday.', 'error');
            return;
        }
        
        if (endDate.getDay() === 0 || endDate.getDay() === 6) {
            showMessage('Cannot apply leave ending on a weekend. Please select a weekday.', 'error');
            return;
        }
        
        const formData = {
            leaveType: leaveTypeSelect.value,
            startDate: startDateInput.value,
            endDate: endDateInput.value,
            reason: document.getElementById('reason').value,
            days: parseFloat(daysInput.value)
        };
        
        // Disable submit button to prevent double submission
        const submitButton = leaveForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Submitting...';
        
        try {
            const response = await fetch('/api/apply-leave', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                showMessage('Leave application submitted successfully! Status: Pending approval. An email has been sent to your manager.', 'success');
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 2000);
            } else {
                showMessage(result.message || 'Failed to submit leave application', 'error');
                submitButton.disabled = false;
                submitButton.textContent = 'Submit Application';
            }
        } catch (error) {
            showMessage('An error occurred. Please try again.', 'error');
            console.error('Submit error:', error);
            submitButton.disabled = false;
            submitButton.textContent = 'Submit Application';
        }
    });
}

function showMessage(text, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}
