# Hướng dẫn sử dụng hệ thống AirHCM
Nguồn: Tài liệu hệ thống AirHCM – WebGIS và ứng dụng di động dự báo chất lượng không khí TP. Hồ Chí Minh

## AirHCM là gì
AirHCM là hệ thống WebGIS và ứng dụng di động giám sát, dự báo bụi mịn PM2.5 và hỗ trợ ra quyết định bảo vệ sức khỏe cho người dân TP. Hồ Chí Minh. Hệ thống kết hợp số liệu trạm quan trắc lưu trong cơ sở dữ liệu không gian PostGIS, dữ liệu khí tượng và chất lượng không khí từ Open-Meteo, mô hình học máy dự báo PM2.5 24 giờ tới, và Trợ lý AI tư vấn sức khỏe.

## Dữ liệu và mô hình dự báo
Dữ liệu chất lượng không khí được thu thập định kỳ (ETL) từ Open-Meteo Air Quality API và lưu vào PostGIS. Mô hình học máy Random Forest dự báo nồng độ PM2.5 theo từng giờ trong 24 giờ tới. Dữ liệu gió 10 m và nhiệt độ 2 m theo giờ lấy từ Open-Meteo để vẽ dòng chảy gió và tính nhiệt độ tại từng vị trí trên bản đồ.

## Cảnh báo tự động (DSS Engine)
Mỗi 30 phút, DSS Engine lấy chuỗi dự báo AI và đối chiếu ngưỡng PM2.5 50 µg/m³ của QCVN 05:2023. Nếu vượt, hệ thống kích hoạt trạng thái Warning_NhayCam: hiện banner cảnh báo trên WebGIS, gửi thông báo đẩy (Firebase Cloud Messaging) kèm tiếng còi báo động tới điện thoại đã đăng ký với ngưỡng US AQI người dùng chọn (100, 150 hoặc 200), và gợi ý khung giờ nên ra ngoài và khung giờ nên tránh. Thông báo đẩy được giãn cách tối thiểu 3 giờ để tránh làm phiền.

## Cách dùng bản đồ WebGIS
Bản đồ hiển thị chỉ số theo 166 phường/xã, trạm quan trắc, bản đồ nhiệt và dòng chảy gió. Kéo thanh mô phỏng 24 giờ để xem diễn biến theo giờ. Gõ tên địa điểm vào thanh tìm kiếm hoặc bấm nút định vị để xem AQI, PM2.5, nhiệt độ, gió, khoảng cách và đường đi tới địa điểm. Chỉ đường hỗ trợ 4 phương tiện: ô tô, xe máy (tự tránh đường cao tốc vì cấm xe máy), xe đạp và đi bộ, kèm thời gian ước tính (chưa tính ùn tắc) và lời khuyên bảo vệ sức khỏe theo từng phương tiện. Bấm vào một phường để xem nhanh chỉ số; chuột phải (máy tính) hoặc nhấn giữ (điện thoại) để phân tích chi tiết dự báo 24 giờ tại điểm bất kỳ. Có thể đổi bản đồ nền (Sáng, Tối, Đường phố, Vệ tinh) và chuyển giữa VN_AQI và US AQI.

## Đăng ký nhận cảnh báo và tài khoản
Người dùng đăng nhập bằng email hoặc tài khoản Google, Facebook, Apple; tài khoản dùng chung giữa WebGIS và ứng dụng di động. Ở mục đăng ký nhận cảnh báo, chọn phường/xã theo dõi và ngưỡng AQI để nhận thông báo đẩy và email khi AI dự báo ô nhiễm vượt ngưỡng. Trên điện thoại có thể bật/tắt tiếng còi cảnh báo và nghe thử.
