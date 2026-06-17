document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch
    if (window.api && window.dashboard) {
        fetchData();
        
        // Realtime Dashboard Loop
        setInterval(async () => {
            fetchData();
        }, 2000);
    } else {
        console.error("API or Dashboard module missing.");
    }

    async function fetchData() {
        try {
            const data = await window.api.getStatus();
            window.dashboard.updateDashboard(data);
        } catch (error) {
            console.error("Error fetching data:", error);
        }
    }
});
