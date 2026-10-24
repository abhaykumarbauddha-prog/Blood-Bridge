document.addEventListener('DOMContentLoaded', async () => {
    const stats = await window.BloodMatchData?.getHomepageStats();
    if (!stats) return;
    const values = {
        'homepage-donors': stats.donors,
        'homepage-hospitals': stats.verifiedHospitals,
        'homepage-donations': stats.fulfilledDonations
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value === null ? '-' : String(value);
    });
});
