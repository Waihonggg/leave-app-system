// Apply Leave functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Set minimum date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('startDate').setAttribute('min', today);
    document.getElementById('endDate').setAttribute('min', today);
    
    // Load user data for balance display
    await loadUserBalance();
    
    // Setup form handlers
    setupFormHandlers();
    
    // Setup logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            const response = await fetch('/api/logout', { method: 'POST' });
            const result = await response.json();
            localStorage.removeItem('username');
            if (result.success) {
                window.location.href = 'login.html';
            }
        } catch (e) {
            console.error("Logout error:", e);
        }
    });
});

async function loadUserBalance() {
    try {
        const response = await fetch('/api/leave-data');
        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Failed to load user data');
        }
        
        const result = await response.json();
        if (result.success && result.data) {
            document.getElementById('currentBalance').textContent = result.data.leaveBalance || 0;
            document.getElementById('currentMCBalance').textContent = result.data.mcBalance || 0;
        }
    } catch (error) {
        console.error('Error loading user balance:', error);
    }
}

function setupFormHandlers() {
    const form = document.getElementById('leaveForm');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const daysInput = document.getElementById('days');
    const leaveType = document.getElementById('leaveType');
    
    // Calculate days when dates change
    startDate.addEventListener('change', calculateDays);
    endDate.addEventListener('change', calculateDays);
    
    // Show/hide MC balance based on leave type
    leaveType.addEventListener('change', () => {
        const mcBalanceInfo = document.getElementById('mcBalanceInfo');
        if (leaveType.value === 'MC') {
            mcBalanceInfo.style.display = 'flex';
        } else {
            mcBalanceInfo.style.display = 'none';
        }
    });
    
    // Form submission
    form.addEventListener('submit', handleSubmit);
}

function calculateDays() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const daysInput = document.getElementById('days');
    
    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (end < start) {
            showMessage('End date must be after start date', 'error');
            daysInput.value = '';
            return;
        }
        
        // Calculate business days (excluding weekends)
        let days = 0;
        const current = new Date(start);
        
        while (current <= end) {
            const dayOfWeek = current.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
                days++;
            }
            current.setDate(current.getDate() + 1);
        }
        
        daysInput.value = days;
    }
}

async function handleSubmit(e) {
    e.preventDefault();
    
    const formData = {
        leaveType: document.getElementById('leaveType').value,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        reason: document.getElementById('reason').value,
        days: document.getElementById('days').value
    };
    
    // Validate weekend selection
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    
    // Check if start or end date is weekend (for non-WFH leave)
    if (formData.leaveType !== 'WFH') {
        if (start.getDay() === 0 || start.getDay() === 6) {
            showMessage('Start date cannot be on a weekend', 'error');
            return;
        }
        if (end.getDay() === 0 || end.getDay() === 6) {
            showMessage('End date cannot be on a weekend', 'error');
            return;
        }
    }
    
    // Validate days
    if (!formData.days || formData.days <= 0) {
        showMessage('Please select valid dates', 'error');
        return;
    }
    
    // Show loading state
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    submitButton.disabled = true;
    
    try {
        const response = await fetch('/api/apply-leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showMessage('Leave application submitted successfully!', 'success');
            // Reset form
            e.target.reset();
            document.getElementById('days').value = '';
            
            // Redirect after 2 seconds
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 2000);
        } else {
            showMessage(result.message || 'Failed to submit leave application', 'error');
        }
    } catch (error) {
        console.error('Error submitting leave:', error);
        showMessage('An error occurred. Please try again.', 'error');
    } finally {
        submitButton.innerHTML = originalText;
        submitButton.disabled = false;
    }
}

function showMessage(text, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}
