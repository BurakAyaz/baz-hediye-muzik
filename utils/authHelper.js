// utils/authHelper.js (GÜNCELLENMIŞ - Wix token decode)

const API_BASE = '';
const AUTH_TOKEN_KEY = 'authToken';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 gün

// ==================== TOKEN YÖNETİMİ ====================

function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setToken(token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function removeToken() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
}

// ==================== LOGIN (Wix Token Decode İLE) ====================

export async function login(credentials) {
    try {
        console.log('🔐 Login başlatılıyor...');
        
        // Wix token'dan gelen veri
        let userData = credentials;
        
        // Eğer base64 token ise decode et
        if (typeof credentials === 'string') {
            try {
                userData = JSON.parse(atob(credentials));
                console.log('📦 Token decode edildi:', userData);
            } catch (e) {
                console.error('❌ Token decode hatası:', e);
                return { success: false, error: 'Invalid token' };
            }
        }
        
        // API'ye gönder
        const response = await fetch('/api/auth-sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'login',
                data: {
                    wixUserId: userData.userId,
                    email: userData.odaSahibi || userData.email,
                    displayName: userData.displayName || 'Wix User'
                }
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            setToken(data.token);
            console.log('✅ Login başarılı:', data.user);
            return { success: true, user: data.user };
        } else {
            console.error('❌ Login başarısız:', data.error);
            return { success: false, error: data.error };
        }
    } catch (error) {
        console.error('❌ Login error:', error);
        return { success: false, error: error.message };
    }
}

// ==================== SESSION SYNC ====================

export async function syncSession() {
    try {
        const token = getToken();
        
        if (!token) {
            console.log('ℹ️ Token yok');
            return { success: false, error: 'No token' };
        }
        
        const response = await fetch('/api/auth-sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'sync'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Session sync:', data.user);
            return { success: true, user: data.user };
        } else {
            removeToken();
            return { success: false, error: data.error };
        }
    } catch (error) {
        console.error('❌ Sync error:', error);
        removeToken();
        return { success: false, error: error.message };
    }
}

// ==================== LOGOUT ====================

export async function logout() {
    try {
        const token = getToken();
        
        if (token) {
            await fetch('/api/auth-sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action: 'logout'
                })
            });
        }
        
        removeToken();
        console.log('✅ Logout başarılı');
        return { success: true };
    } catch (error) {
        removeToken();
        return { success: true };
    }
}

// ==================== API REQUEST HELPER ====================

export async function apiRequest(url, options = {}) {
    const token = getToken();
    
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return fetch(url, {
        ...options,
        headers
    });
}