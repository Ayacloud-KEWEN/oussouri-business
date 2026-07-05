#!/bin/sh
# 每日数据库备份 → OVH Object Storage（S3 兼容）
# 依赖: docker、aws-cli（或 s3cmd）；由宿主机 cron 调用，见 docs/step-10-deployment.md §6
# 环境变量: S3_ENDPOINT S3_BUCKET_BACKUP AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY POSTGRES_USER POSTGRES_DB
set -eu

STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="/tmp/oussouri-${STAMP}.sql.gz"
RETENTION_DAYS=30

docker compose -f "$(dirname "$0")/../docker-compose.prod.yml" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB:-oussouri}" | gzip > "${FILE}"

aws s3 cp "${FILE}" "s3://${S3_BUCKET_BACKUP}/pg/${STAMP}.sql.gz" --endpoint-url "${S3_ENDPOINT}"
rm -f "${FILE}"

# 清理过期备份
CUTOFF=$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -u -v-${RETENTION_DAYS}d +%Y%m%d)
aws s3 ls "s3://${S3_BUCKET_BACKUP}/pg/" --endpoint-url "${S3_ENDPOINT}" | while read -r _ _ _ key; do
  base=$(basename "${key}" .sql.gz)
  day=$(echo "${base}" | cut -d- -f1)
  if [ "${day}" -lt "${CUTOFF}" ] 2>/dev/null; then
    aws s3 rm "s3://${S3_BUCKET_BACKUP}/pg/${key}" --endpoint-url "${S3_ENDPOINT}"
  fi
done

echo "backup ok: ${STAMP}"
