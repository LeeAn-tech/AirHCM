import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_facebook_auth/flutter_facebook_auth.dart' as fb;

import 'api_service.dart';

enum SocialProvider { google, facebook, apple }

/// Người dùng tự đóng cửa sổ đăng nhập - không cần báo lỗi
class SocialAuthCancelled implements Exception {}

/// Đăng nhập / đăng ký bằng Google, Facebook, Apple - đồng bộ với WebGIS AirHCM:
/// Firebase Authentication mở trang đăng nhập THẬT của nhà cung cấp (Chrome Custom Tab),
/// lấy Firebase ID token rồi Backend xác minh token và tạo / trả về tài khoản thành viên.
///
/// Riêng Facebook trên Android: điều khoản Facebook bắt buộc dùng Facebook SDK (Firebase chặn luồng
/// Custom Tab chung với lỗi "Sign in with Facebook is not supported via this method"). App đăng nhập
/// qua Facebook SDK (app Facebook đã cài, hoặc trình duyệt) -> access token -> Firebase -> Backend.
class SocialAuth {
  SocialAuth._();

  static String label(SocialProvider p) => switch (p) {
        SocialProvider.google => 'Google',
        SocialProvider.facebook => 'Facebook',
        SocialProvider.apple => 'Apple',
      };

  static AuthProvider _provider(SocialProvider p) => switch (p) {
        // Luôn hiện danh sách tài khoản Google trên máy để người dùng chọn
        SocialProvider.google => GoogleAuthProvider()..setCustomParameters({'prompt': 'select_account'}),
        SocialProvider.facebook => FacebookAuthProvider()
          ..addScope('email')
          ..addScope('public_profile'),
        SocialProvider.apple => AppleAuthProvider()
          ..addScope('email')
          ..addScope('name'),
      };

  /// Trả về tài khoản AirHCM (Map) hoặc ném [ApiException] / [SocialAuthCancelled]
  static Future<Map<String, dynamic>> signIn(SocialProvider p) async {
    final name = label(p);
    if (Firebase.apps.isEmpty) {
      throw ApiException('Firebase chưa sẵn sàng trên thiết bị này nên chưa thể đăng nhập bằng $name.');
    }
    final auth = FirebaseAuth.instance;
    try {
      final UserCredential cred;
      if (kIsWeb) {
        cred = await auth.signInWithPopup(_provider(p));
      } else if (p == SocialProvider.facebook) {
        cred = await _signInWithFacebookSdk(auth);
      } else {
        cred = await auth.signInWithProvider(_provider(p));
      }
      final user = cred.user;
      final token = await user?.getIdToken();
      if (user == null || token == null) throw ApiException('$name không trả về thông tin tài khoản.');
      // Một số tài khoản (Google Workspace / email trường học) chỉ có tên trong dữ liệu nhà cung cấp
      final displayName = user.displayName ??
          user.providerData.map((p) => p.displayName).firstWhere((n) => n != null && n.isNotEmpty, orElse: () => null);
      return await ApiService.socialLogin(token, fullname: displayName);
    } on FirebaseAuthException catch (e) {
      final message = describe(e, name);
      if (message == null) throw SocialAuthCancelled();
      throw ApiException(message);
    } finally {
      // Phiên AirHCM lưu trong máy (AppState); không giữ phiên Firebase / Facebook SDK
      try {
        await auth.signOut();
      } catch (_) {}
      if (p == SocialProvider.facebook && !kIsWeb) {
        try {
          await fb.FacebookAuth.instance.logOut();
        } catch (_) {}
      }
    }
  }

  /// Facebook SDK -> access token -> đăng nhập Firebase (Firebase xác minh token với Facebook)
  static Future<UserCredential> _signInWithFacebookSdk(FirebaseAuth auth) async {
    final fb.LoginResult result;
    try {
      result = await fb.FacebookAuth.instance.login(permissions: const ['email', 'public_profile']);
    } catch (e) {
      throw ApiException(_facebookSdkError('$e'));
    }
    switch (result.status) {
      case fb.LoginStatus.success:
        final token = result.accessToken?.tokenString;
        if (token == null || token.isEmpty) throw ApiException('Facebook không trả về mã đăng nhập.');
        return auth.signInWithCredential(FacebookAuthProvider.credential(token));
      case fb.LoginStatus.cancelled:
        throw SocialAuthCancelled();
      case fb.LoginStatus.operationInProgress:
        throw ApiException('Cửa sổ đăng nhập Facebook đang mở. Vui lòng hoàn tất hoặc đóng cửa sổ đó.');
      case fb.LoginStatus.failed:
        throw ApiException(_facebookSdkError(result.message ?? ''));
    }
  }

  /// Lỗi cấu hình thường gặp của Facebook SDK -> hướng dẫn dễ hiểu
  static String _facebookSdkError(String raw) {
    debugPrint('Đăng nhập Facebook SDK lỗi: $raw');
    final msg = raw.toLowerCase();
    // Thiếu Client Token: Facebook SDK không khởi tạo được nên plugin không được đăng ký (MissingPluginException)
    if (msg.contains('client token') || msg.contains('not been initialized') || msg.contains('application id') ||
        msg.contains('missingplugin') || msg.contains('no implementation found')) {
      return 'App chưa được cấu hình Facebook (thiếu FACEBOOK_CLIENT_TOKEN trong backend/.env). '
          'Quản trị viên cần thêm Client Token rồi build lại app.';
    }
    if (msg.contains('key hash')) {
      return 'Ứng dụng Meta chưa đăng ký key hash của app Android AirHCM. Quản trị viên cần thêm key hash '
          'trong Meta for Developers → Cài đặt → Cơ bản → Android.';
    }
    if (msg.contains('app not active') || msg.contains('not available') || msg.contains('development mode')) {
      return 'Ứng dụng Facebook của AirHCM đang ở chế độ phát triển: chỉ tài khoản quản trị / người thử nghiệm '
          'của ứng dụng Meta mới đăng nhập được.';
    }
    if (msg.contains('connection') || msg.contains('network')) {
      return 'Không kết nối được Facebook. Vui lòng kiểm tra Internet và thử lại.';
    }
    return raw.isNotEmpty ? 'Đăng nhập Facebook thất bại: $raw' : 'Đăng nhập Facebook thất bại.';
  }

  /// Thông báo lỗi dễ hiểu; null = người dùng tự đóng cửa sổ đăng nhập
  static String? describe(FirebaseAuthException e, String name) {
    debugPrint('Đăng nhập $name lỗi: ${e.code} - ${e.message}');
    switch (e.code) {
      case 'web-context-canceled':
      case 'web-context-cancelled':
      case 'canceled':
      case 'popup-closed-by-user':
      case 'cancelled-popup-request':
        return null;
      case 'operation-not-allowed':
        return 'Đăng nhập bằng $name chưa được bật. Quản trị viên cần bật $name trong Firebase Console → Authentication → Sign-in method.';
      case 'account-exists-with-different-credential':
        return 'Email của tài khoản này đã dùng để đăng nhập bằng phương thức khác. Hãy đăng nhập bằng phương thức bạn đã dùng trước đó.';
      case 'network-request-failed':
      case 'web-network-request-failed':
        return 'Không kết nối được máy chủ xác thực. Vui lòng kiểm tra Internet và thử lại.';
      case 'web-context-already-presented':
        return 'Cửa sổ đăng nhập đang mở. Vui lòng hoàn tất hoặc đóng cửa sổ đó.';
      case 'app-not-authorized':
        return 'Ứng dụng chưa được cấp quyền dùng Firebase Authentication (kiểm tra SHA-1 của ứng dụng trong Firebase).';
      case 'user-disabled':
        return 'Tài khoản $name này đã bị vô hiệu hóa.';
      case 'invalid-credential':
        return 'Cấu hình đăng nhập $name trên Firebase chưa đúng (App ID / Secret / Service ID).';
      default:
        final msg = e.message ?? '';
        if (msg.contains('CONFIGURATION_NOT_FOUND')) {
          return 'Dự án Firebase chưa kích hoạt Authentication cho $name.';
        }
        return msg.isNotEmpty ? 'Đăng nhập $name thất bại: $msg' : 'Đăng nhập $name thất bại (${e.code}).';
    }
  }
}
