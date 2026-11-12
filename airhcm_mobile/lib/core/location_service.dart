import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

class LocationException implements Exception {
  final String message;
  LocationException(this.message);

  @override
  String toString() => message;
}

/// Lấy tọa độ GPS của thiết bị (Sequence Diagram: "Gửi request kèm tọa độ")
class LocationService {
  LocationService._();

  static Future<LatLng> currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationException('Dịch vụ định vị (GPS) đang tắt. Hãy bật vị trí trên điện thoại.');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      throw LocationException('Bạn chưa cấp quyền truy cập vị trí cho AirHCM.');
    }
    if (permission == LocationPermission.deniedForever) {
      throw LocationException('Quyền vị trí bị từ chối vĩnh viễn. Vào Cài đặt > Ứng dụng > AirHCM để bật lại.');
    }

    final pos = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
      timeLimit: const Duration(seconds: 15),
    );
    return LatLng(pos.latitude, pos.longitude);
  }
}
