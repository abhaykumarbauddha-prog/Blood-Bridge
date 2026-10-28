// UX guard only. Supabase RLS remains the real security boundary.
window.requireRole = async function requireRole(allowedRoles) {
    const client = window.bloodBridgeSupabase;
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!client?.auth) {
        window.location.replace('auth.html');
        return false;
    }

    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
        window.location.replace('auth.html');
        return false;
    }

    let userRole = null;
    try {
        const { data: roleRow, error } = await client
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .maybeSingle();
        if (!error && roleRow?.role) {
            userRole = roleRow.role;
        }
    } catch (_) {}

    // Admin access must always come from the database role table. Never trust
    // localStorage or user metadata for this privilege.
    if (!userRole && roles.includes('Admin')) {
        window.location.replace('dashboard.html');
        return false;
    }

    if (!userRole) {
        userRole = user.user_metadata?.role || localStorage.getItem('blood_bridge_user_role') || 'Donor';
    }

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    if (!roles.includes(userRole)) {
        let target = 'dashboard.html';
        if (userRole === 'Hospital') target = 'hospital-dashboard.html';
        else if (userRole === 'Admin') target = 'admin-dashboard.html';
        
        if (currentPage !== target) {
            window.location.replace(target);
        }
        return false;
    }
    return true;
};

document.addEventListener('DOMContentLoaded', () => {
    const page = window.location.pathname.split('/').pop();
    if (page === 'dashboard.html' || page === 'user-dashboard.html') {
        window.requireRole(['Donor', 'Requester']);
    } else if (page === 'hospital-dashboard.html') {
        window.requireRole('Hospital');
    } else if (page === 'admin-dashboard.html' || page === 'admin-management.html') {
        window.requireRole('Admin');
    }
});
