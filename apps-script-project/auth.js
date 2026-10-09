var AUTH_PASSWORD_PROPERTY = 'BREEDING_APP_PASSWORD';
var AUTH_TOKEN_PREFIX = 'auth_token_';
var AUTH_TOKEN_TTL_SECONDS = 21600; // 6 hours

function getBreedingAppPassword_() {
  var password = PropertiesService.getScriptProperties().getProperty(AUTH_PASSWORD_PROPERTY);
  if (!password) {
    throw new Error('アプリの初期設定が未完了です。管理者へ連絡してください。');
  }
  return password;
}

function issueAuthToken(password) {
  if (String(password || '') !== getBreedingAppPassword_()) {
    throw new Error('パスワードが違います');
  }
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(AUTH_TOKEN_PREFIX + token, '1', AUTH_TOKEN_TTL_SECONDS);
  return { token: token, expiresIn: AUTH_TOKEN_TTL_SECONDS };
}

function isAuthTokenValid_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(AUTH_TOKEN_PREFIX + String(token)) === '1';
}

function requireAuth_(token) {
  if (!isAuthTokenValid_(token)) {
    var error = new Error('認証が切れました。もう一度パスワードを入力してください。');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
}

/** 疎通確認は認証不要。業務データや認証情報を返さず、シートも開かない。 */
function ping(authToken) {
  try {
    var authenticated = isAuthTokenValid_(authToken);
    return {
      reachable: true, authenticated: authenticated,
      status: authenticated ? 'online' : 'auth', authRequired: !authenticated,
      retryable: false, protocolVersion: 2
    };
  } catch (error) {
    return {
      reachable: true, authenticated: false, status: 'server',
      authRequired: false, retryable: true, errorKind: 'network',
      error: '認証サービスへ一時的に接続できません。', protocolVersion: 2
    };
  }
}
