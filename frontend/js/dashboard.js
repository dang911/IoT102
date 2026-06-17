const TEMP_THRESHOLD = 35; // Configurable threshold

// Variables to track temperature history
let tempHistory = [];
let maxTemp = -Infinity;
let minTemp = Infinity;

// Function to update the dashboard UI based on data
function updateDashboard(data) {
    if (!data) return;

    // Update Temperature History
    const currentTemp = parseFloat(data.temperature);
    if (!isNaN(currentTemp)) {
        tempHistory.push(currentTemp);
        if (currentTemp > maxTemp) maxTemp = currentTemp;
        if (currentTemp < minTemp) minTemp = currentTemp;
        
        const sumTemp = tempHistory.reduce((a, b) => a + b, 0);
        const avgTemp = (sumTemp / tempHistory.length).toFixed(1);

        document.getElementById('temp-max').textContent = maxTemp.toFixed(1);
        document.getElementById('temp-min').textContent = minTemp.toFixed(1);
        document.getElementById('temp-avg').textContent = avgTemp;
    }

    // Update Temperature
    const tempValue = document.getElementById('temp-value');
    const tempStatus = document.getElementById('temp-status');
    const tempAlerts = [];
    
    tempValue.textContent = `${currentTemp.toFixed(1)}°C`;
    
    if (currentTemp > TEMP_THRESHOLD) {
        tempStatus.textContent = "High";
        tempStatus.className = "text-danger";
        tempValue.className = "value text-danger";
        tempAlerts.push('<li class="alert-item danger">⚠ High Temperature Detected</li>');
    } else {
        tempStatus.textContent = "Normal";
        tempStatus.className = "text-cyan";
        tempValue.className = "value text-cyan";
    }

    // Update Light Sensor
    const lightValue = document.getElementById('light-value');
    const envStatus = document.getElementById('env-status');
    const ledStatus = document.getElementById('led-status');
    
    lightValue.textContent = `${data.lightLevel} Lux`;
    
    if (data.lightLevel < 200) {
        envStatus.textContent = "Dark";
        tempAlerts.push('<li class="alert-item warning">⚠ Low Light Detected</li>');
    } else {
        envStatus.textContent = "Bright";
    }

    // Update LED Badge
    if (data.lightStatus) {
        ledStatus.textContent = "ON";
        ledStatus.className = "badge badge-success";
    } else {
        ledStatus.textContent = "OFF";
        ledStatus.className = "badge badge-off";
    }

    // Update Control Panel Buttons
    updateToggleButtons('mode-buttons', data.mode);
    updateToggleButtons('light-buttons', data.lightStatus ? 'ON' : 'OFF');

    // Update Alerts
    const alertList = document.getElementById('alert-list');
    if (tempAlerts.length > 0) {
        alertList.innerHTML = tempAlerts.join('');
    } else {
        alertList.innerHTML = '<li class="alert-item success">✓ System Normal</li>';
    }
}

function updateToggleButtons(containerId, activeValue) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const buttons = container.querySelectorAll('.btn');
    buttons.forEach(btn => {
        const value = btn.dataset.mode || btn.dataset.light;
        if (value === activeValue) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Mobile sidebar toggle and button listeners
document.addEventListener('DOMContentLoaded', () => {
    const hamburger = document.getElementById('hamburger-menu');
    const sidebar = document.querySelector('.sidebar');
    
    if (hamburger && sidebar) {
        hamburger.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open') && e.target !== hamburger && !sidebar.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });

    // Event listeners for controls
    const modeButtons = document.querySelectorAll('#mode-buttons .btn');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = e.target.dataset.mode;
            if(window.api && window.api.setMode) {
                window.api.setMode(mode);
            }
            updateToggleButtons('mode-buttons', mode);
        });
    });

    const lightButtons = document.querySelectorAll('#light-buttons .btn');
    lightButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const status = e.target.dataset.light;
            if(window.api && window.api.setLight) {
                window.api.setLight(status);
            }
            updateToggleButtons('light-buttons', status);
        });
    });
});

window.dashboard = {
    updateDashboard
};
