// Authentication handling
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Store username in localStorage for client-side use
            localStorage.setItem('username', username);
            // Redirect to dashboard
            window.location.href = 'dashboard.html';
        } else {
            errorMessage.textContent = data.message || 'Login failed';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        errorMessage.textContent = 'An error occurred. Please try again.';
        errorMessage.style.display = 'block';
        console.error('Login error:', error);
    }
});

// Clear error message when user starts typing
document.getElementById('username').addEventListener('input', () => {
    document.getElementById('error-message').style.display = 'none';
});

document.getElementById('password').addEventListener('input', () => {
    document.getElementById('error-message').style.display = 'none';
});
