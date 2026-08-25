-- Migration number: 0007
UPDATE lucky_products
SET picture_url = COALESCE(
    NULLIF(TRIM(json_extract(raw, '$.pictureUrl')), ''),
    NULLIF(TRIM(json_extract(raw, '$.defaultPicUrl')), ''),
    NULLIF(TRIM(json_extract(raw, '$.picUrl')), '')
)
WHERE (picture_url IS NULL OR TRIM(picture_url) = '')
    AND json_valid(raw)
    AND COALESCE(
        NULLIF(TRIM(json_extract(raw, '$.pictureUrl')), ''),
        NULLIF(TRIM(json_extract(raw, '$.defaultPicUrl')), ''),
        NULLIF(TRIM(json_extract(raw, '$.picUrl')), '')
    ) IS NOT NULL;
