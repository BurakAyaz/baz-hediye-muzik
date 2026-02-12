try {
    require('./api/proxy.js');
    console.log('✅ api/proxy.js syntax is correct');
    require('./api/lyrics.js');
    console.log('✅ api/lyrics.js syntax is correct');
    require('./api/generate-lyrics.js');
    console.log('✅ api/generate-lyrics.js syntax is correct');
} catch (error) {
    console.error('❌ Syntax error:', error);
    process.exit(1);
}
