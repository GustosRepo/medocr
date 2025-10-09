# MEDOCR Offline Deployment

Files:
- medocr-api-<ver>.tar.gz
- medocr-frontend-<ver>.tar.gz
- medocr-ocr-<ver>.tar.gz
- compose.release.yml
- .env (provide separately)

Steps (Windows PowerShell):
1. Extract tar.gz files (7zip or built-in) to .tar in same folder.
2. Load images:
   docker load -i medocr-api-<ver>.tar
   docker load -i medocr-frontend-<ver>.tar
   docker load -i medocr-ocr-<ver>.tar
3. Verify: docker images | findstr medocr
4. Place .env and compose.release.yml together.
5. Run: docker compose -f compose.release.yml --env-file .env up -d
6. Open http://localhost:8080

Update: repeat load with new version tarballs, then: docker compose pull (or just up -d with new tags).
