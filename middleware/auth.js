import wixUsersBackend from 'wix-users-backend';

export async function generateUserToken(userId) {
    try {
        const user = await wixUsersBackend.getUser(userId);
        
        const timestamp = Date.now();
        const tokenData = {
            userId: userId,
            email: user.loginEmail || '',
            displayName: user.nickname || user.firstName || '',
            timestamp: timestamp
        };
        
        const token = btoa(JSON.stringify(tokenData));
        
        return {
            success: true,
            token: token,
            user: {
                id: userId,
                email: user.loginEmail,
                name: user.nickname || user.firstName || ''
            }
        };
    } catch (error) {
        console.error('Token generation error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}
