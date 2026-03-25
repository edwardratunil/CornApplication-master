<?php

// Update these values with your Hostinger database credentials.
const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';
const ALLOWED_AVATARS = ['farmer1', 'farmer2', 'farmer3', 'farmer4', 'farmer5', 'farmer6'];

function logDebug(string $message): void
{
    $timestamp = date('Y-m-d H:i:s');
    @file_put_contents(__DIR__ . '/auth_debug.log', "[$timestamp] $message\n", FILE_APPEND);
}

/**
 * Log user activity to the logs table
 * 
 * @param mysqli $db Database connection
 * @param int $userId User ID
 * @param string $actionType Action type (e.g., 'login', 'logout', 'profile_update')
 * @param string $description Description of the action
 * @param string|null $entityType Entity type (e.g., 'user', 'farm', 'device')
 * @param int|null $entityId Entity ID
 * @param array|null $metadata Additional metadata as array (will be JSON encoded)
 */
function logUserActivity(
    mysqli $db,
    int $userId,
    string $actionType,
    string $description,
    ?string $entityType = null,
    ?int $entityId = null,
    ?array $metadata = null
): void {
    try {
        $ipAddress = $_SERVER['REMOTE_ADDR'] ?? null;
        $clientSource = 'mobile_app'; // Can be enhanced to detect web vs mobile
        
        $metadataJson = null;
        if ($metadata !== null) {
            $metadataJson = json_encode($metadata);
        }
        
        $stmt = $db->prepare(
            'INSERT INTO logs (users_id, log_type, action_type, entity_type, entity_id, description, ip_address, client_source, metadata) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        
        $logType = 'user_action';
        $stmt->bind_param(
            'isssissss',
            $userId,
            $logType,
            $actionType,
            $entityType,
            $entityId,
            $description,
            $ipAddress,
            $clientSource,
            $metadataJson
        );
        
        $stmt->execute();
        $stmt->close();
    } catch (mysqli_sql_exception $exception) {
        // Log error but don't fail the main operation
        error_log('Failed to log user activity: ' . $exception->getMessage());
    }
}

/**
 * Log failed login attempt to the logs table
 * 
 * @param mysqli $db Database connection
 * @param int|null $userId User ID (null if user doesn't exist)
 * @param string $email Email address used in login attempt
 * @param string $reason Reason for failure (e.g., 'Invalid password', 'User not found', 'Email not verified')
 */
function logFailedLoginAttempt(
    mysqli $db,
    ?int $userId,
    string $email,
    string $reason
): void {
    try {
        $ipAddress = $_SERVER['REMOTE_ADDR'] ?? null;
        $clientSource = 'mobile_app';
        
        $metadata = [
            'email' => $email,
            'reason' => $reason,
            'attempt_type' => 'login_failed'
        ];
        $metadataJson = json_encode($metadata);
        
        $logType = 'security_event';
        $actionType = 'login_failed';
        $description = "Failed login attempt: {$reason}";
        $entityType = 'user';
        $entityId = $userId;
        
        // Handle NULL user_id - use separate INSERT for NULL case
        if ($userId === null) {
            $stmt = $db->prepare(
                'INSERT INTO logs (users_id, log_type, action_type, entity_type, entity_id, description, ip_address, client_source, metadata) 
                 VALUES (NULL, ?, ?, ?, NULL, ?, ?, ?, ?)'
            );
            $stmt->bind_param(
                'sssssss',
                $logType,
                $actionType,
                $entityType,
                $description,
                $ipAddress,
                $clientSource,
                $metadataJson
            );
        } else {
            $stmt = $db->prepare(
                'INSERT INTO logs (users_id, log_type, action_type, entity_type, entity_id, description, ip_address, client_source, metadata) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->bind_param(
                'isssissss',
                $userId,
                $logType,
                $actionType,
                $entityType,
                $entityId,
                $description,
                $ipAddress,
                $clientSource,
                $metadataJson
            );
        }
        
        $stmt->execute();
        $stmt->close();
    } catch (mysqli_sql_exception $exception) {
        // Silently fail - don't interrupt login flow
        error_log('Failed to log failed login attempt: ' . $exception->getMessage());
    }
}

set_error_handler(static function ($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(static function (Throwable $throwable): void {
    error_log('auth.php exception: ' . $throwable->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }

    echo json_encode([
        'success' => false,
        'message' => 'Internal server error.',
        'error' => $throwable->getMessage(),
    ]);
});

register_shutdown_function(static function (): void {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        error_log('auth.php fatal error: ' . $error['message']);
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }

        echo json_encode([
            'success' => false,
            'message' => 'Fatal server error.',
            'error' => $error['message'],
        ]);
    }
});

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $connection = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $connection->set_charset('utf8mb4');
    if (!defined('HAS_AVATAR_COLUMN')) {
        $hasAvatarColumn = ensureAvatarColumnExists($connection);
        define('HAS_AVATAR_COLUMN', $hasAvatarColumn);
    }
    if (!defined('HAS_EMAIL_VERIFIED_COLUMN')) {
        $hasEmailVerifiedColumn = ensureEmailVerifiedColumnExists($connection);
        define('HAS_EMAIL_VERIFIED_COLUMN', $hasEmailVerifiedColumn);
    }
    initializeEmailVerificationsTable($connection);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed',
        'error' => $exception->getMessage(),
    ]);
    exit;
}

// Handle GET request for email verification link
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'verify_email') {
    $token = trim($_GET['token'] ?? '');
    if ($token !== '') {
        handleVerifyEmailWeb($connection, $token);
    } else {
        renderVerificationPage(false, 'Verification token is required.');
    }
    $connection->close();
    exit;
}

$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true);

if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'message' => 'Invalid JSON body.',
    ]);
    exit;
}

$action = isset($payload['action']) ? strtolower(trim($payload['action'])) : '';

switch ($action) {
    case 'register':
        handleRegister($connection, $payload);
        break;
    case 'login':
        handleLogin($connection, $payload);
        break;
    case 'update_profile':
        handleUpdateProfile($connection, $payload);
        break;
    case 'request_password_reset':
        handleRequestPasswordReset($connection, $payload);
        break;
    case 'verify_password_reset':
        handleVerifyPasswordReset($connection, $payload);
        break;
    case 'reset_password':
        handlePerformPasswordReset($connection, $payload);
        break;
    case 'verify_email':
        handleVerifyEmail($connection, $payload);
        break;
    case 'resend_verification_email':
        handleResendVerificationEmail($connection, $payload);
        break;
    case 'logout':
        handleLogout($connection, $payload);
        break;
    case 'heartbeat':
        handleHeartbeat($connection, $payload);
        break;
    default:
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'Unsupported action. Use "register" or "login".',
        ]);
}

$connection->close();

function normalizeAvatar(?string $avatar): string
{
    $avatarId = strtolower(trim((string)$avatar));
    return in_array($avatarId, ALLOWED_AVATARS, true) ? $avatarId : 'farmer1';
}

function isAvatarColumnAvailable(): bool
{
    return defined('HAS_AVATAR_COLUMN') && HAS_AVATAR_COLUMN === true;
}

function ensureAvatarColumnExists(mysqli $db): bool
{
    try {
        $result = $db->query("SHOW COLUMNS FROM users LIKE 'avatar'");
        if ($result && $result->num_rows > 0) {
            $result->close();
            logDebug('ensureAvatarColumnExists: column already exists');
            return true;
        }

        if ($result) {
            $result->close();
        }

        $db->query("ALTER TABLE users ADD COLUMN avatar VARCHAR(32) NOT NULL DEFAULT 'farmer1'");
        $db->query("UPDATE users SET avatar = 'farmer1' WHERE avatar IS NULL OR avatar = ''");
        logDebug('ensureAvatarColumnExists: column created');
        return true;
    } catch (mysqli_sql_exception $exception) {
        // Log the error but allow the app to continue without avatar persistence.
        error_log('Avatar column setup failed: ' . $exception->getMessage());
        logDebug('ensureAvatarColumnExists: failed - ' . $exception->getMessage());
        return false;
    }
}

function initializePasswordResetTable(mysqli $db): void
{
    $sql = <<<SQL
CREATE TABLE IF NOT EXISTS password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL;

    $db->query($sql);
}

function ensureEmailVerifiedColumnExists(mysqli $db): bool
{
    try {
        $result = $db->query("SHOW COLUMNS FROM users LIKE 'email_verified'");
        if ($result && $result->num_rows > 0) {
            $result->close();
            logDebug('ensureEmailVerifiedColumnExists: column already exists');
            return true;
        }

        if ($result) {
            $result->close();
        }

        $db->query("ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0");
        $db->query("UPDATE users SET email_verified = 0 WHERE email_verified IS NULL");
        logDebug('ensureEmailVerifiedColumnExists: column created');
        return true;
    } catch (mysqli_sql_exception $exception) {
        error_log('Email verified column setup failed: ' . $exception->getMessage());
        logDebug('ensureEmailVerifiedColumnExists: failed - ' . $exception->getMessage());
        return false;
    }
}

function isEmailVerifiedColumnAvailable(): bool
{
    return defined('HAS_EMAIL_VERIFIED_COLUMN') && HAS_EMAIL_VERIFIED_COLUMN === true;
}

function initializeEmailVerificationsTable(mysqli $db): void
{
    $sql = <<<SQL
CREATE TABLE IF NOT EXISTS email_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_user_id (user_id),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL;

    $db->query($sql);
}

function generateVerificationToken(): string
{
    return bin2hex(random_bytes(32));
}

function sendVerificationEmail(string $email, string $firstName, string $token): bool
{
    $verificationUrl = 'https://cropmist.com/server/auth.php?action=verify_email&token=' . urlencode($token);
    
    $subject = 'Verify Your Corn Mist Account Email';
    
    // HTML email
    $htmlMessage = <<<HTML
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 40px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🌽 Corn Mist</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 24px;">Hello {$firstName}!</h2>
                            <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                                Thank you for registering with Corn Mist! To complete your registration, please verify your email address by clicking the button below.
                            </p>
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="{$verificationUrl}" style="display: inline-block; background-color: #667eea; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">Verify Email Address</a>
                                    </td>
                                </tr>
                            </table>
                            <p style="color: #999999; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                                Or copy and paste this link into your browser:<br>
                                <a href="{$verificationUrl}" style="color: #667eea; word-break: break-all;">{$verificationUrl}</a>
                            </p>
                            <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 30px 0 0 0; border-top: 1px solid #eeeeee; padding-top: 20px;">
                                This verification link will expire in 24 hours.<br>
                                If you did not create an account, please ignore this email.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 20px 40px; background-color: #f9f9f9; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="color: #999999; font-size: 12px; margin: 0;">
                                © Corn Mist - Agricultural Monitoring System
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
HTML;

    // Plain text fallback
    $textMessage = <<<TEXT
Hello {$firstName},

Thank you for registering with Corn Mist!

Please verify your email address by clicking the link below:

{$verificationUrl}

This link will expire in 24 hours.

If you did not create an account, please ignore this email.

Best regards,
Corn Mist Team
TEXT;

    $boundary = uniqid('boundary_');
    
    $headers = "From: Corn Mist <noreply@cropmist.com>\r\n";
    $headers .= "Reply-To: support@cropmist.com\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    $body = "--{$boundary}\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
    $body .= $textMessage . "\r\n\r\n";
    $body .= "--{$boundary}\r\n";
    $body .= "Content-Type: text/html; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
    $body .= $htmlMessage . "\r\n\r\n";
    $body .= "--{$boundary}--";

    return @mail($email, $subject, $body, $headers);
}

function handleRegister(mysqli $db, array $data): void
{
    logDebug('handleRegister: start');
    $firstName = trim($data['first_name'] ?? '');
    $lastName = trim($data['last_name'] ?? '');
    $email = strtolower(trim($data['email'] ?? ''));
    $password = $data['password'] ?? '';
    $avatar = normalizeAvatar($data['avatar'] ?? null);
    $hasAvatarColumn = isAvatarColumnAvailable();

    if ($firstName === '' || $lastName === '' || $email === '' || $password === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'All fields (first_name, last_name, email, password) are required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    try {
        $checkStmt = $db->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $checkStmt->bind_param('s', $email);
        $checkStmt->execute();
        $checkStmt->store_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to check existing user.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    if ($checkStmt->num_rows > 0) {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'message' => 'An account with that email already exists.',
        ]);
        $checkStmt->close();
        return;
    }
    $checkStmt->close();

    // Validate strong password requirements
    if (strlen($password) < 8) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Password must be at least 8 characters long.',
        ]);
        return;
    }

    if (!preg_match('/[A-Z]/', $password)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Password must contain at least one uppercase letter.',
        ]);
        return;
    }

    if (!preg_match('/[a-z]/', $password)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Password must contain at least one lowercase letter.',
        ]);
        return;
    }

    if (!preg_match('/[0-9]/', $password)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Password must contain at least one number.',
        ]);
        return;
    }

    if (!preg_match('/[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]/', $password)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?).',
        ]);
        return;
    }

    $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
    $role = 'user';
    $hasEmailVerifiedColumn = isEmailVerifiedColumnAvailable();

    try {
        logDebug('handleRegister: preparing insert (avatar column available: ' . ($hasAvatarColumn ? 'yes' : 'no') . ', email_verified: ' . ($hasEmailVerifiedColumn ? 'yes' : 'no') . ')');
        
        // Insert user with email_verified = 0 (not verified)
        if ($hasAvatarColumn && $hasEmailVerifiedColumn) {
            $insertStmt = $db->prepare('INSERT INTO users (first_name, last_name, email, password, role, avatar, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0)');
            $insertStmt->bind_param('ssssss', $firstName, $lastName, $email, $hashedPassword, $role, $avatar);
        } elseif ($hasAvatarColumn) {
            $insertStmt = $db->prepare('INSERT INTO users (first_name, last_name, email, password, role, avatar) VALUES (?, ?, ?, ?, ?, ?)');
            $insertStmt->bind_param('ssssss', $firstName, $lastName, $email, $hashedPassword, $role, $avatar);
        } elseif ($hasEmailVerifiedColumn) {
            $insertStmt = $db->prepare('INSERT INTO users (first_name, last_name, email, password, role, email_verified) VALUES (?, ?, ?, ?, ?, 0)');
            $insertStmt->bind_param('sssss', $firstName, $lastName, $email, $hashedPassword, $role);
        } else {
            $insertStmt = $db->prepare('INSERT INTO users (first_name, last_name, email, password, role) VALUES (?, ?, ?, ?, ?)');
            $insertStmt->bind_param('sssss', $firstName, $lastName, $email, $hashedPassword, $role);
        }
        logDebug('handleRegister: executing insert');
        $insertStmt->execute();
        $userId = $insertStmt->insert_id;
        $insertStmt->close();

        // Generate verification token and send email
        if ($hasEmailVerifiedColumn) {
            $token = generateVerificationToken();
            $expiresAt = date('Y-m-d H:i:s', strtotime('+24 hours'));
            
            try {
                $tokenStmt = $db->prepare('INSERT INTO email_verifications (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)');
                $tokenStmt->bind_param('isss', $userId, $email, $token, $expiresAt);
                $tokenStmt->execute();
                $tokenStmt->close();
                
                // Send verification email
                $emailSent = sendVerificationEmail($email, $firstName, $token);
                logDebug('handleRegister: verification email ' . ($emailSent ? 'sent' : 'failed to send'));
            } catch (mysqli_sql_exception $exception) {
                logDebug('handleRegister: failed to create verification token - ' . $exception->getMessage());
                // Continue even if token creation fails
            }
        }

        // Log user registration activity
        logUserActivity(
            $db,
            $userId,
            'register',
            'User registered successfully',
            'user',
            $userId,
            ['email' => $email, 'email_verified' => false]
        );

        echo json_encode([
            'success' => true,
            'message' => $hasEmailVerifiedColumn ? 'Registration successful. Please check your email to verify your account.' : 'Registration successful.',
            'data' => [
                'id' => $userId,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'email' => $email,
                'role' => $role,
                'avatar' => $hasAvatarColumn ? $avatar : 'farmer1',
                'email_verified' => $hasEmailVerifiedColumn ? false : null,
            ],
        ]);
    } catch (mysqli_sql_exception $exception) {
        logDebug('handleRegister: sql exception - ' . $exception->getMessage());
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to register user.',
            'error' => $exception->getMessage(),
        ]);
    } catch (Throwable $throwable) {
        logDebug('handleRegister: throwable - ' . $throwable->getMessage());
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Unexpected error during registration.',
            'error' => $throwable->getMessage(),
        ]);
    }
}

function handleLogin(mysqli $db, array $data): void
{
    $email = strtolower(trim($data['email'] ?? ''));
    $password = $data['password'] ?? '';

    if ($email === '' || $password === '') {
        // Log failed login attempt - missing credentials
        try {
            logFailedLoginAttempt($db, null, $email, 'Missing email or password');
        } catch (Throwable $e) {
            // Silently fail logging
        }
        
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Both email and password are required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        // Log failed login attempt - invalid email format
        try {
            logFailedLoginAttempt($db, null, $email, 'Invalid email format');
        } catch (Throwable $e) {
            // Silently fail logging
        }
        
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    $hasAvatarColumn = isAvatarColumnAvailable();
    $hasEmailVerifiedColumn = isEmailVerifiedColumnAvailable();

    try {
        $selectFields = 'id, first_name, last_name, email, password, role';
        if ($hasAvatarColumn) {
            $selectFields .= ', avatar';
        }
        if ($hasEmailVerifiedColumn) {
            $selectFields .= ', email_verified';
        }
        $stmt = $db->prepare("SELECT {$selectFields} FROM users WHERE email = ? LIMIT 1");
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to query user.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    if ($result && $row = $result->fetch_assoc()) {
        if (password_verify($password, $row['password'])) {
            // Check if email is verified
            $hasEmailVerifiedColumn = isEmailVerifiedColumnAvailable();
            if ($hasEmailVerifiedColumn && isset($row['email_verified']) && (int)$row['email_verified'] === 0) {
                // Log failed login attempt - email not verified
                $userId = (int)$row['id'];
                try {
                    logFailedLoginAttempt($db, $userId, $email, 'Email not verified');
                } catch (Throwable $e) {
                    // Silently fail logging
                }
                
                http_response_code(403);
                echo json_encode([
                    'success' => false,
                    'message' => 'Please verify your email address before logging in. Check your inbox for the verification email.',
                    'email_not_verified' => true,
                ]);
                return;
            }
            
            // Update activity_status, last_logged_in, and last_active_at on successful login
            $userId = (int)$row['id'];
            $now = date('Y-m-d H:i:s');
            try {
                $updateStmt = $db->prepare("UPDATE users SET activity_status = 'Active', last_logged_in = ?, last_active_at = ? WHERE id = ?");
                $updateStmt->bind_param('ssi', $now, $now, $userId);
                $updateStmt->execute();
                $updateStmt->close();
                
                // Log user login activity
                logUserActivity(
                    $db,
                    $userId,
                    'login',
                    'User logged in successfully',
                    'user',
                    $userId,
                    ['email' => $email]
                );
            } catch (mysqli_sql_exception $exception) {
                // Log error but don't fail login
                error_log('Failed to update activity_status on login: ' . $exception->getMessage());
            }
            
            unset($row['password']);
            $row['avatar'] = $hasAvatarColumn ? normalizeAvatar($row['avatar'] ?? null) : 'farmer1';
            echo json_encode([
                'success' => true,
                'message' => 'Login successful.',
                'data' => $row,
            ]);
        } else {
            // Log failed login attempt - wrong password
            $userId = (int)$row['id'];
            try {
                logFailedLoginAttempt($db, $userId, $email, 'Invalid password');
            } catch (Throwable $e) {
                // Silently fail logging
            }
            
            http_response_code(401);
            echo json_encode([
                'success' => false,
                'message' => 'Invalid email or password.',
            ]);
        }
    } else {
        // Log failed login attempt - user not found
        try {
            logFailedLoginAttempt($db, null, $email, 'User not found');
        } catch (Throwable $e) {
            // Silently fail logging
        }
        
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Invalid email or password.',
        ]);
    }

    $stmt->close();
}

function handleLogout(mysqli $db, array $data): void
{
    $userId = isset($data['user_id']) ? (int)$data['user_id'] : 0;

    if ($userId <= 0) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'user_id is required.',
        ]);
        return;
    }

    try {
        // Update activity_status to 'Offline' on logout
        $updateStmt = $db->prepare("UPDATE users SET activity_status = 'Offline' WHERE id = ?");
        $updateStmt->bind_param('i', $userId);
        $updateStmt->execute();
        $updateStmt->close();
        
        // Log user logout activity
        logUserActivity(
            $db,
            $userId,
            'logout',
            'User logged out',
            'user',
            $userId
        );
        
        echo json_encode([
            'success' => true,
            'message' => 'Logout successful.',
        ]);
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to update logout status.',
            'error' => $exception->getMessage(),
        ]);
    }
}

function handleHeartbeat(mysqli $db, array $data): void
{
    $userId = isset($data['user_id']) ? (int)$data['user_id'] : 0;

    if ($userId <= 0) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'user_id is required.',
        ]);
        return;
    }

    try {
        // Update last_active_at and ensure activity_status is 'Active'
        $now = date('Y-m-d H:i:s');
        $updateStmt = $db->prepare("UPDATE users SET last_active_at = ?, activity_status = 'Active' WHERE id = ?");
        $updateStmt->bind_param('si', $now, $userId);
        $updateStmt->execute();
        $updateStmt->close();
        
        echo json_encode([
            'success' => true,
            'message' => 'Heartbeat received.',
        ]);
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to update heartbeat.',
            'error' => $exception->getMessage(),
        ]);
    }
}

function handleUpdateProfile(mysqli $db, array $data): void
{
    $userId = isset($data['user_id']) ? (int)$data['user_id'] : 0;
    $firstName = trim($data['first_name'] ?? '');
    $lastName = trim($data['last_name'] ?? '');
    $email = strtolower(trim($data['email'] ?? ''));
    $newPassword = $data['new_password'] ?? '';
    $avatarProvided = array_key_exists('avatar', $data);
    $normalizedAvatar = $avatarProvided ? normalizeAvatar($data['avatar']) : null;
    $hasAvatarColumn = isAvatarColumnAvailable();

    if ($userId <= 0 || $firstName === '' || $lastName === '' || $email === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'user_id, first_name, last_name, and email are required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    try {
        $lookupStmt = $db->prepare('SELECT id, email, avatar FROM users WHERE id = ? LIMIT 1');
        $lookupStmt->bind_param('i', $userId);
        $lookupStmt->execute();
        $result = $lookupStmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to fetch user information.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $existingUser = $result ? $result->fetch_assoc() : null;
    $lookupStmt->close();

    if (!$existingUser) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'User not found.',
        ]);
        return;
    }

    if (strcasecmp($existingUser['email'], $email) !== 0) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'message' => 'Email does not match the authenticated user.',
        ]);
        return;
    }

    $updateFields = ['first_name = ?', 'last_name = ?'];
    $types = 'ss';
    $params = [$firstName, $lastName];

    $currentAvatar = $hasAvatarColumn ? normalizeAvatar($existingUser['avatar'] ?? null) : 'farmer1';
    $effectiveAvatar = $currentAvatar;

    if ($hasAvatarColumn && $avatarProvided) {
        $effectiveAvatar = $normalizedAvatar;
        $updateFields[] = 'avatar = ?';
        $types .= 's';
        $params[] = $effectiveAvatar;
    }

    if ($newPassword !== '') {
        $oldPassword = $data['old_password'] ?? '';
        
        if ($oldPassword === '') {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Current password is required to change password.',
            ]);
            return;
        }

        // Verify old password
        try {
            $passwordStmt = $db->prepare('SELECT password FROM users WHERE id = ? LIMIT 1');
            $passwordStmt->bind_param('i', $userId);
            $passwordStmt->execute();
            $passwordResult = $passwordStmt->get_result();
            $passwordRow = $passwordResult ? $passwordResult->fetch_assoc() : null;
            $passwordStmt->close();

            if (!$passwordRow || !password_verify($oldPassword, $passwordRow['password'])) {
                http_response_code(401);
                echo json_encode([
                    'success' => false,
                    'message' => 'Current password is incorrect.',
                ]);
                return;
            }
        } catch (mysqli_sql_exception $exception) {
            http_response_code(500);
            echo json_encode([
                'success' => false,
                'message' => 'Failed to verify current password.',
                'error' => $exception->getMessage(),
            ]);
            return;
        }

        // Validate strong password requirements
        if (strlen($newPassword) < 8) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Password must be at least 8 characters long.',
            ]);
            return;
        }

        if (!preg_match('/[A-Z]/', $newPassword)) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Password must contain at least one uppercase letter.',
            ]);
            return;
        }

        if (!preg_match('/[a-z]/', $newPassword)) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Password must contain at least one lowercase letter.',
            ]);
            return;
        }

        if (!preg_match('/[0-9]/', $newPassword)) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Password must contain at least one number.',
            ]);
            return;
        }

        if (!preg_match('/[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]/', $newPassword)) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?).',
            ]);
            return;
        }

        $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
        $updateFields[] = 'password = ?';
        $types .= 's';
        $params[] = $hashedPassword;
    }

    $types .= 'i';
    $params[] = $userId;

    $sql = 'UPDATE users SET ' . implode(', ', $updateFields) . ' WHERE id = ?';

    try {
        $updateStmt = $db->prepare($sql);
        $updateStmt->bind_param($types, ...$params);
        $updateStmt->execute();
        $updateStmt->close();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to update user profile.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    // Log profile update activity
    $metadata = [
        'fields_updated' => ['first_name', 'last_name']
    ];
    if ($avatarProvided) {
        $metadata['fields_updated'][] = 'avatar';
        $metadata['avatar_changed'] = true;
    }
    if ($newPassword !== '') {
        $metadata['fields_updated'][] = 'password';
        $metadata['password_changed'] = true;
    }
    
    logUserActivity(
        $db,
        $userId,
        'profile_update',
        'User profile updated' . ($newPassword !== '' ? ' (password changed)' : ''),
        'user',
        $userId,
        $metadata
    );

    echo json_encode([
        'success' => true,
        'message' => 'Profile updated successfully.',
        'data' => [
            'id' => $userId,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
            'avatar' => $effectiveAvatar,
        ],
    ]);
}

function handleRequestPasswordReset(mysqli $db, array $data): void
{
    initializePasswordResetTable($db);

    $email = strtolower(trim($data['email'] ?? ''));

    if ($email === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Email is required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    try {
        $stmt = $db->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to query user for password reset.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $user = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$user) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'No account found with that email address.',
        ]);
        return;
    }

    $otp = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $otpHash = password_hash($otp, PASSWORD_BCRYPT);
    $expiresAt = (new DateTime('+10 minutes'))->format('Y-m-d H:i:s');

    try {
        $deleteStmt = $db->prepare('DELETE FROM password_resets WHERE email = ?');
        $deleteStmt->bind_param('s', $email);
        $deleteStmt->execute();
        $deleteStmt->close();

        $insertStmt = $db->prepare('INSERT INTO password_resets (email, otp_hash, expires_at) VALUES (?, ?, ?)');
        $insertStmt->bind_param('sss', $email, $otpHash, $expiresAt);
        $insertStmt->execute();
        $insertStmt->close();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to store reset token.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $emailSent = sendOtpEmail($email, $otp);

    echo json_encode([
        'success' => true,
        'message' => $emailSent
            ? 'A one-time password has been sent to your email.'
            : 'OTP generated but email delivery may have failed. Please check server email configuration.',
        'data' => [
            'expires_at' => $expiresAt,
        ],
    ]);
}

function handleVerifyPasswordReset(mysqli $db, array $data): void
{
    initializePasswordResetTable($db);

    $email = strtolower(trim($data['email'] ?? ''));
    $otp = trim($data['otp'] ?? '');

    if ($email === '' || $otp === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Email and OTP are required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    try {
        $stmt = $db->prepare('SELECT otp_hash, expires_at FROM password_resets WHERE email = ? ORDER BY created_at DESC LIMIT 1');
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to verify OTP.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $record = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$record) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'No OTP request found for that email.',
        ]);
        return;
    }

    $expiresAt = DateTime::createFromFormat('Y-m-d H:i:s', $record['expires_at']);
    $now = new DateTime('now');

    if ($expiresAt < $now) {
        http_response_code(410);
        echo json_encode([
            'success' => false,
            'message' => 'The OTP has expired. Please request a new one.',
        ]);
        return;
    }

    if (!password_verify($otp, $record['otp_hash'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Invalid OTP provided.',
        ]);
        return;
    }

    echo json_encode([
        'success' => true,
        'message' => 'OTP verified successfully.',
    ]);
}

function handlePerformPasswordReset(mysqli $db, array $data): void
{
    initializePasswordResetTable($db);

    $email = strtolower(trim($data['email'] ?? ''));
    $otp = trim($data['otp'] ?? '');
    $newPassword = $data['new_password'] ?? '';

    if ($email === '' || $otp === '' || $newPassword === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Email, OTP, and new_password are required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    if (strlen($newPassword) < 8) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'New password must be at least 8 characters long.',
        ]);
        return;
    }

    try {
        $stmt = $db->prepare('SELECT otp_hash, expires_at FROM password_resets WHERE email = ? ORDER BY created_at DESC LIMIT 1');
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to verify OTP.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $record = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$record) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'No OTP request found for that email.',
        ]);
        return;
    }

    $expiresAt = DateTime::createFromFormat('Y-m-d H:i:s', $record['expires_at']);
    $now = new DateTime('now');

    if ($expiresAt < $now) {
        http_response_code(410);
        echo json_encode([
            'success' => false,
            'message' => 'The OTP has expired. Please request a new one.',
        ]);
        return;
    }

    if (!password_verify($otp, $record['otp_hash'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Invalid OTP provided.',
        ]);
        return;
    }

    $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);

    try {
        $updateStmt = $db->prepare('UPDATE users SET password = ? WHERE email = ?');
        $updateStmt->bind_param('ss', $hashedPassword, $email);
        $updateStmt->execute();
        $updateStmt->close();

        $deleteStmt = $db->prepare('DELETE FROM password_resets WHERE email = ?');
        $deleteStmt->bind_param('s', $email);
        $deleteStmt->execute();
        $deleteStmt->close();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to reset password.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    echo json_encode([
        'success' => true,
        'message' => 'Password reset successfully.',
    ]);
}

function sendOtpEmail(string $toEmail, string $otp): bool
{
    $subject = 'CORN MIST Password Reset OTP';
    $message = "Hello,\n\nYour one-time password (OTP) for resetting your CORN MIST account is: {$otp}\n\nThis OTP will expire in 10 minutes. If you did not request a password reset, please ignore this email.\n\nThank you,\nCORN MIST Team";

    $headers = "From: noreply@cropmist.com\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

    return @mail($toEmail, $subject, $message, $headers);
}

function handleVerifyEmail(mysqli $db, array $data): void
{
    $token = trim($data['token'] ?? '');
    
    if ($token === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Verification token is required.',
        ]);
        return;
    }

    try {
        $stmt = $db->prepare('SELECT user_id, email, expires_at FROM email_verifications WHERE token = ? LIMIT 1');
        $stmt->bind_param('s', $token);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to verify token.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $record = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$record) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'Invalid or expired verification token.',
        ]);
        return;
    }

    $expiresAt = DateTime::createFromFormat('Y-m-d H:i:s', $record['expires_at']);
    $now = new DateTime('now');

    if ($expiresAt < $now) {
        http_response_code(410);
        echo json_encode([
            'success' => false,
            'message' => 'Verification token has expired. Please request a new verification email.',
        ]);
        return;
    }

    $userId = (int)$record['user_id'];
    $hasEmailVerifiedColumn = isEmailVerifiedColumnAvailable();

    if (!$hasEmailVerifiedColumn) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Email verification is not available on this system.',
        ]);
        return;
    }

    try {
        // Update user's email_verified status
        $updateStmt = $db->prepare('UPDATE users SET email_verified = 1 WHERE id = ?');
        $updateStmt->bind_param('i', $userId);
        $updateStmt->execute();
        $updateStmt->close();

        // Delete used verification token
        $deleteStmt = $db->prepare('DELETE FROM email_verifications WHERE token = ?');
        $deleteStmt->bind_param('s', $token);
        $deleteStmt->execute();
        $deleteStmt->close();

        // Log email verification activity
        logUserActivity(
            $db,
            $userId,
            'email_verified',
            'User email verified successfully',
            'user',
            $userId,
            ['email' => $record['email']]
        );

        echo json_encode([
            'success' => true,
            'message' => 'Email verified successfully. You can now log in.',
        ]);
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to verify email.',
            'error' => $exception->getMessage(),
        ]);
    }
}

function renderVerificationPage(bool $success, string $message, ?string $redirectUrl = null): void
{
    header('Content-Type: text/html; charset=UTF-8');
    
    $title = $success ? 'Email Verified Successfully' : 'Email Verification Failed';
    $icon = $success ? '✓' : '✗';
    $color = $success ? '#4CAF50' : '#F44336';
    $bgColor = $success ? '#E8F5E9' : '#FFEBEE';
    
    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{$title} - Corn Mist</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            width: 100%;
            padding: 40px;
            text-align: center;
            animation: slideUp 0.5s ease-out;
        }
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .icon {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: {$bgColor};
            color: {$color};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 48px;
            margin: 0 auto 24px;
            border: 3px solid {$color};
        }
        h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 16px;
            font-weight: 600;
        }
        .message {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
        }
        .button {
            display: inline-block;
            background: {$color};
            color: white;
            padding: 14px 32px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
        }
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
        }
        .button:active {
            transform: translateY(0);
        }
        .footer {
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 14px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">{$icon}</div>
        <h1>{$title}</h1>
        <p class="message">{$message}</p>
HTML;
    
    echo <<<HTML
        <div class="footer">
            <div class="logo">🌽 Corn Mist</div>
            <p>Agricultural Monitoring System</p>
        </div>
    </div>
</body>
</html>
HTML;
}

function handleVerifyEmailWeb(mysqli $db, string $token): void
{
    // Clean up expired tokens periodically (10% chance to run cleanup)
    if (rand(1, 10) === 1) {
        try {
            $db->query("DELETE FROM email_verifications WHERE expires_at < NOW()");
        } catch (mysqli_sql_exception $e) {
            // Silently fail cleanup
        }
    }

    // Validate token format (should be 64 hex characters)
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/i', $token)) {
        renderVerificationPage(false, 'Invalid verification token format. Please use the link from your verification email.');
        return;
    }

    try {
        $stmt = $db->prepare('SELECT user_id, email, expires_at FROM email_verifications WHERE token = ? LIMIT 1');
        $stmt->bind_param('s', $token);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        error_log('Email verification error: ' . $exception->getMessage());
        renderVerificationPage(false, 'An error occurred while verifying your email. Please try again later or contact support.');
        return;
    }

    $record = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$record) {
        renderVerificationPage(false, 'Invalid or expired verification link. Please request a new verification email from the app login screen.');
        return;
    }

    $expiresAt = DateTime::createFromFormat('Y-m-d H:i:s', $record['expires_at']);
    $now = new DateTime('now');

    if ($expiresAt < $now) {
        // Delete expired token
        try {
            $deleteStmt = $db->prepare('DELETE FROM email_verifications WHERE token = ?');
            $deleteStmt->bind_param('s', $token);
            $deleteStmt->execute();
            $deleteStmt->close();
        } catch (mysqli_sql_exception $e) {
            // Continue even if deletion fails
        }
        
        renderVerificationPage(false, 'This verification link has expired. Please request a new verification email from the app login screen.');
        return;
    }

    $userId = (int)$record['user_id'];
    $hasEmailVerifiedColumn = isEmailVerifiedColumnAvailable();

    if (!$hasEmailVerifiedColumn) {
        renderVerificationPage(false, 'Email verification is not available on this system. Please contact support.');
        return;
    }

    // Check if already verified
    try {
        $checkStmt = $db->prepare('SELECT email_verified FROM users WHERE id = ? LIMIT 1');
        $checkStmt->bind_param('i', $userId);
        $checkStmt->execute();
        $userResult = $checkStmt->get_result();
        $user = $userResult ? $userResult->fetch_assoc() : null;
        $checkStmt->close();

        if ($user && (int)$user['email_verified'] === 1) {
            // Already verified, delete token and show success
            try {
                $deleteStmt = $db->prepare('DELETE FROM email_verifications WHERE token = ?');
                $deleteStmt->bind_param('s', $token);
                $deleteStmt->execute();
                $deleteStmt->close();
            } catch (mysqli_sql_exception $e) {
                // Continue
            }
            
            renderVerificationPage(true, 'Your email is already verified! You can log in to the Corn Mist app.');
            return;
        }
    } catch (mysqli_sql_exception $e) {
        // Continue with verification
    }

    try {
        // Update user's email_verified status
        $updateStmt = $db->prepare('UPDATE users SET email_verified = 1 WHERE id = ?');
        $updateStmt->bind_param('i', $userId);
        $updateStmt->execute();
        $updateStmt->close();

        // Delete used verification token
        $deleteStmt = $db->prepare('DELETE FROM email_verifications WHERE token = ?');
        $deleteStmt->bind_param('s', $token);
        $deleteStmt->execute();
        $deleteStmt->close();

        // Log email verification activity
        logUserActivity(
            $db,
            $userId,
            'email_verified',
            'User email verified successfully via web',
            'user',
            $userId,
            ['email' => $record['email'], 'source' => 'web']
        );

        renderVerificationPage(true, 'Your email has been verified successfully! You can now log in to the Corn Mist app.');
    } catch (mysqli_sql_exception $exception) {
        error_log('Email verification update error: ' . $exception->getMessage());
        renderVerificationPage(false, 'Failed to complete email verification. Please try again later or contact support.');
    }
}

function handleResendVerificationEmail(mysqli $db, array $data): void
{
    $email = strtolower(trim($data['email'] ?? ''));

    if ($email === '') {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Email is required.',
        ]);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Please provide a valid email address.',
        ]);
        return;
    }

    $hasEmailVerifiedColumn = isEmailVerifiedColumnAvailable();
    if (!$hasEmailVerifiedColumn) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Email verification is not available on this system.',
        ]);
        return;
    }

    try {
        $stmt = $db->prepare('SELECT id, first_name, email_verified FROM users WHERE email = ? LIMIT 1');
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $result = $stmt->get_result();
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to query user.',
            'error' => $exception->getMessage(),
        ]);
        return;
    }

    $user = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$user) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'No account found with that email address.',
        ]);
        return;
    }

    if ((int)$user['email_verified'] === 1) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'Email is already verified.',
        ]);
        return;
    }

    // Generate new verification token
    $token = generateVerificationToken();
    $expiresAt = date('Y-m-d H:i:s', strtotime('+24 hours'));
    $userId = (int)$user['id'];

    try {
        // Delete old tokens for this user
        $deleteStmt = $db->prepare('DELETE FROM email_verifications WHERE user_id = ?');
        $deleteStmt->bind_param('i', $userId);
        $deleteStmt->execute();
        $deleteStmt->close();

        // Insert new token
        $tokenStmt = $db->prepare('INSERT INTO email_verifications (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)');
        $tokenStmt->bind_param('isss', $userId, $email, $token, $expiresAt);
        $tokenStmt->execute();
        $tokenStmt->close();

        // Send verification email
        $emailSent = sendVerificationEmail($email, $user['first_name'], $token);
        logDebug('handleResendVerificationEmail: verification email ' . ($emailSent ? 'sent' : 'failed to send'));

        echo json_encode([
            'success' => true,
            'message' => 'Verification email sent. Please check your inbox.',
        ]);
    } catch (mysqli_sql_exception $exception) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to send verification email.',
            'error' => $exception->getMessage(),
        ]);
    }
}


