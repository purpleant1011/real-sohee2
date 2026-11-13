# HEIC 변환 테스트 자료

`synthetic-photo.heic`는 같은 디렉터리의 기존 합성 자료 `synthetic-photo.png`를 macOS `sips -s format heic`로 변환한 파일이다. 고객 사진이나 개인정보를 포함하지 않는다.

원본/출력 치수는 480×640이다. macOS 인코더가 사용하는 64비트 `mdat` 박스와 세로 사진 디코딩을 검사한다. 실제 iPhone 촬영·EXIF 회전·HDR·Live Photo·다중 이미지 HEIF 지원을 입증하지 않는다. 24MP 초과 사진과 시퀀스 형식은 현재 보수적으로 거절한다.
