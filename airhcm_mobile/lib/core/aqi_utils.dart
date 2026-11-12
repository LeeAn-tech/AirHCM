import 'package:flutter/material.dart';

/// Khuyến cáo sức khỏe cho cộng đồng và nhóm nhạy cảm
class AqiAdvice {
  final String general;
  final String sensitive;
  const AqiAdvice(this.general, this.sensitive);
}

/// Thuật toán & bảng màu AQI - giống hệt WebGIS (app.js) để hai nền tảng hiển thị cùng số liệu.
class AqiUtils {
  AqiUtils._();

  /// VN_AQI theo Quyết định 1459/QĐ-TCMT
  static int vn(double pm) {
    if (pm.isNaN || pm < 0) return 0;
    if (pm <= 25.0) return ((50.0 / 25.0) * pm).round();
    if (pm <= 50.0) return (((100.0 - 51.0) / (50.0 - 25.1)) * (pm - 25.1) + 51.0).round();
    if (pm <= 80.0) return (((150.0 - 101.0) / (80.0 - 50.1)) * (pm - 50.1) + 101.0).round();
    if (pm <= 150.0) return (((200.0 - 151.0) / (150.0 - 80.1)) * (pm - 80.1) + 151.0).round();
    if (pm <= 250.0) return (((300.0 - 201.0) / (250.0 - 150.1)) * (pm - 150.1) + 201.0).round();
    if (pm <= 500.0) return (((500.0 - 301.0) / (500.0 - 250.1)) * (pm - 250.1) + 301.0).round();
    return 500;
  }

  /// US AQI theo US EPA
  static int us(double pm) {
    if (pm.isNaN || pm < 0) return 0;
    if (pm <= 12.0) return ((50 / 12.0) * pm).round();
    if (pm <= 35.4) return (((100 - 51) / (35.4 - 12.0)) * (pm - 12.0) + 51).round();
    if (pm <= 55.4) return (((150 - 101) / (55.4 - 35.4)) * (pm - 35.4) + 101).round();
    if (pm <= 150.4) return (((200 - 151) / (150.4 - 55.4)) * (pm - 55.4) + 151).round();
    if (pm <= 250.4) return (((300 - 201) / (250.4 - 150.4)) * (pm - 150.4) + 201).round();
    if (pm <= 350.4) return (((400 - 301) / (350.4 - 250.4)) * (pm - 250.4) + 301).round();
    if (pm <= 500.4) return (((500 - 401) / (500.4 - 350.4)) * (pm - 350.4) + 401).round();
    return 500;
  }

  static int compute(double pm, {required bool useUS}) => useUS ? us(pm) : vn(pm);

  static String standardLabel(bool useUS) => useUS ? 'US AQI' : 'VN_AQI';

  /// Cấp độ 1..6
  static int levelIndex(int aqi) {
    if (aqi <= 50) return 1;
    if (aqi <= 100) return 2;
    if (aqi <= 150) return 3;
    if (aqi <= 200) return 4;
    if (aqi <= 300) return 5;
    return 6;
  }

  static const List<String> _levels = [
    'Tốt',
    'Trung bình',
    'Kém (nhóm nhạy cảm)',
    'Xấu (Không lành mạnh)',
    'Rất xấu',
    'Nguy hại',
  ];
  static const List<String> _shortLevels = ['Tốt', 'Trung bình', 'Kém', 'Xấu', 'Rất xấu', 'Nguy hại'];

  static String level(int aqi) => _levels[levelIndex(aqi) - 1];
  static String shortLevel(int aqi) => _shortLevels[levelIndex(aqi) - 1];

  /// Màu chuẩn thang AQI (dùng cho bản đồ, vòng tròn chỉ số)
  static const List<Color> _colors = [
    Color(0xFF00E400),
    Color(0xFFFFFF00),
    Color(0xFFFF7E00),
    Color(0xFFFF0000),
    Color(0xFF8F3F97),
    Color(0xFF7E0023),
  ];
  static Color color(int aqi) => _colors[levelIndex(aqi) - 1];

  /// Màu chữ dễ đọc trên nền màu AQI
  static Color onColor(int aqi) => levelIndex(aqi) >= 4 ? Colors.white : const Color(0xFF0F172A);

  /// Màu nhấn (đậm hơn, đọc được trên nền trắng)
  static const List<Color> _strong = [
    Color(0xFF16A34A),
    Color(0xFFCA8A04),
    Color(0xFFEA580C),
    Color(0xFFDC2626),
    Color(0xFF7E22CE),
    Color(0xFF7F1D1D),
  ];
  static Color strong(int aqi) => _strong[levelIndex(aqi) - 1];

  /// Nền & chữ cho nhãn (chip) cấp độ - giống class lvl-* của WebGIS
  static const List<Color> _chipBg = [
    Color(0xFFDCFCE7),
    Color(0xFFFEF9C3),
    Color(0xFFFFEDD5),
    Color(0xFFFEE2E2),
    Color(0xFFF3E8FF),
    Color(0xFFFDE2E4),
  ];
  static const List<Color> _chipFg = [
    Color(0xFF166534),
    Color(0xFF854D0E),
    Color(0xFF9A3412),
    Color(0xFF991B1B),
    Color(0xFF6B21A8),
    Color(0xFF7F1D1D),
  ];
  static Color chipBg(int aqi) => _chipBg[levelIndex(aqi) - 1];
  static Color chipFg(int aqi) => _chipFg[levelIndex(aqi) - 1];

  /// Hệ số biến thiên PM2.5 theo giờ trong ngày tại TP.HCM (giống WebGIS)
  static const Map<int, double> diurnal = {
    0: 1.15, 1: 1.20, 2: 1.22, 3: 1.25, 4: 1.30, 5: 1.35,
    6: 1.40, 7: 1.55, 8: 1.50, 9: 1.30, 10: 1.10, 11: 0.95,
    12: 0.85, 13: 0.80, 14: 0.82, 15: 0.90, 16: 1.15, 17: 1.45,
    18: 1.50, 19: 1.40, 20: 1.25, 21: 1.15, 22: 1.10, 23: 1.12,
  };

  /// Quy đổi nồng độ đo lúc hiện tại sang giờ mô phỏng
  static double atHour(double pmNow, int hour) {
    final nowFactor = diurnal[DateTime.now().hour] ?? 1.0;
    return pmNow * (diurnal[hour] ?? 1.0) / nowFactor;
  }

  static String periodLabel(int hour) {
    if (hour <= 5) return 'Đêm / Sáng sớm';
    if (hour <= 9) return 'Cao điểm sáng';
    if (hour <= 15) return 'Buổi trưa';
    if (hour <= 19) return 'Cao điểm chiều';
    return 'Ban đêm';
  }

  /// Khuyến cáo hỗ trợ ra quyết định theo AQI - giống getAdvisoryForAQI của WebGIS
  static AqiAdvice advice(int aqi) {
    if (aqi <= 50) {
      return const AqiAdvice('Không khí trong lành. Hoạt động bình thường ngoài trời.', 'An toàn cho sức khỏe người nhạy cảm.');
    }
    if (aqi <= 100) {
      return const AqiAdvice('Chất lượng không khí ở mức chấp nhận được.', 'Người nhạy cảm nên giảm vận động thể lực kéo dài.');
    }
    if (aqi <= 150) {
      return const AqiAdvice('Hạn chế tập thể dục gắng sức cạnh đường lớn.', 'BẮT BUỘC đeo khẩu trang N95 khi ra ngoài.');
    }
    if (aqi <= 200) {
      return const AqiAdvice('Nên hạn chế ra ngoài, đóng kín cửa sổ.', 'Tránh hoạt động ngoài trời; bật máy lọc không khí.');
    }
    return const AqiAdvice('Hạn chế tối đa ra đường.', 'Ở trong phòng kín.');
  }

  static double toDouble(dynamic v, [double fallback = 0]) {
    if (v is num) return v.toDouble();
    return double.tryParse('$v') ?? fallback;
  }
}
