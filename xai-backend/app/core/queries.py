# ---------------------------------------------------------------------------
# SQL Queries for ai_products and related tables
# ---------------------------------------------------------------------------

PRODUCT_QUERY = """
WITH feature_agg AS (
    SELECT
        spf.aip_id,
        spf.media_id,
        json_agg(
            json_build_object(
                'feature_id',   f.feature_id,
                'feature_code', f.feature_code,
                'feature_name', f.feature_name,
                'feature_desc', f.feature_desc,
                'media_params', spf.media_params::json
            ) ORDER BY f.feature_id
        ) AS features
    FROM ai_store_product_feature spf
    JOIN ai_feature_list f
        ON f.feature_id = spf.feature_id
    WHERE spf.is_active = true
    GROUP BY spf.aip_id, spf.media_id
),
media_agg AS (
    SELECT
        fa.aip_id,
        json_agg(
            json_build_object(
                'media_id',   m.media_id,
                'media_url',  m.media_url,
                'media_type', m.media_type,
                'features',   fa.features
            ) ORDER BY m.media_id
        ) AS media_gallery
    FROM feature_agg fa
    JOIN ai_media_library m
        ON m.media_id = fa.media_id
    GROUP BY fa.aip_id
),
first_variant AS (
    SELECT DISTINCT ON (shopify_product_id)
        shopify_product_id,
        shopify_variant_id
    FROM ai_product_variants
    ORDER BY shopify_product_id, shopify_variant_id
)
SELECT
    p.aip_id,
    p.shopify_product_id,
    sss.store_name AS shop,
    p.product_title,
    p.product_handle,
    fv.shopify_variant_id,
    p.vendor,
    p.product_type,
    p.description_text,
    p.default_img_id AS default_image_id,
    dm.media_url AS feature_image,
    p.variant_count,
    p.min_price,
    p.max_price,
    p.published_at,
    COALESCE(ma.media_gallery, '[]'::json) AS media_gallery
FROM ai_products p
LEFT JOIN ai_media_library dm
    ON dm.media_id = p.default_img_id
LEFT JOIN media_agg ma
    ON ma.aip_id = p.aip_id
LEFT JOIN seller_shopify_store sss
    ON sss.seller_id = p.seller_id
LEFT JOIN first_variant fv
    ON fv.shopify_product_id = p.shopify_product_id
WHERE p.shopify_product_id = $1;
"""

FEATURE_QUERY = """
SELECT
    spf.feature_id,
    spf.media_id,
    spf.media_params::json AS media_params,
    f.feature_name,
    f.feature_desc
FROM ai_store_product_feature spf
JOIN ai_feature_list f
    ON f.feature_id = spf.feature_id
WHERE spf.aip_id = $1
  AND spf.feature_id = $2
  AND spf.is_active = true
ORDER BY spf.media_id;
"""

GET_HOTSPOTS_BY_MEDIA_ID_QUERY = """
SELECT 
    spf.feature_id,
    f.feature_name,
    f.feature_desc,
    spf.media_params::json AS media_params
FROM ai_store_product_feature spf
JOIN ai_feature_list f ON f.feature_id = spf.feature_id
WHERE spf.media_id = $1 AND spf.is_active = true;
"""

BULK_PRODUCT_QUERY = """
WITH target_products AS (
    SELECT aip_id
    FROM ai_products
    WHERE shopify_product_id = ANY($1::text[])
),
feature_agg AS (
    SELECT
        spf.aip_id,
        spf.media_id,
        json_agg(
            json_build_object(
                'feature_id',   f.feature_id,
                'feature_code', f.feature_code,
                'feature_name', f.feature_name,
                'feature_desc', f.feature_desc,
                'media_params', spf.media_params::json
            ) ORDER BY f.feature_id
        ) AS features
    FROM ai_store_product_feature spf
    JOIN ai_feature_list f
        ON f.feature_id = spf.feature_id
    WHERE spf.is_active = true
      AND spf.aip_id IN (SELECT aip_id FROM target_products)
    GROUP BY spf.aip_id, spf.media_id
),
media_agg AS (
    SELECT
        fa.aip_id,
        json_agg(
            json_build_object(
                'media_id',   m.media_id,
                'media_url',  m.media_url,
                'media_type', m.media_type,
                'features',   fa.features
            ) ORDER BY m.media_id
        ) AS media_gallery
    FROM feature_agg fa
    JOIN ai_media_library m
        ON m.media_id = fa.media_id
    GROUP BY fa.aip_id
),
first_variant AS (
    SELECT DISTINCT ON (shopify_product_id)
        shopify_product_id,
        shopify_variant_id
    FROM ai_product_variants
    ORDER BY shopify_product_id, shopify_variant_id
)
SELECT
    p.aip_id,
    p.shopify_product_id,
    sss.store_name AS shop,
    p.product_title,
    p.product_handle,
    fv.shopify_variant_id,
    p.vendor,
    p.product_type,
    p.description_text,
    dm.media_url AS feature_image,
    p.variant_count,
    p.min_price,
    p.max_price,
    p.published_at,
    COALESCE(ma.media_gallery, '[]'::json) AS media_gallery
FROM ai_products p
LEFT JOIN ai_media_library dm
    ON dm.media_id = p.default_img_id
LEFT JOIN media_agg ma
    ON ma.aip_id = p.aip_id
LEFT JOIN seller_shopify_store sss
    ON sss.seller_id = p.seller_id
LEFT JOIN first_variant fv
    ON fv.shopify_product_id = p.shopify_product_id
WHERE p.aip_id IN (SELECT aip_id FROM target_products)
ORDER BY p.aip_id;
"""

GET_SELLER_BY_TOKEN_QUERY = """
SELECT
    s.seller_id,
    s.seller_shop_name  AS shop,
    s.seller_name       AS store_name,
    s.seller_name       AS brand_name,
    s.logo_url,
    s.theme_color,
    s.text_color,
    s.welcome_image_url AS welcome_image,
    s.welcome_text,
    o.product_id
FROM ai_orders o
JOIN sellers s ON s.seller_id = o.seller_id
WHERE o.ai_call_token = $1
LIMIT 1;
"""

GET_SELLER_BY_PRODUCT_QUERY = """
WITH annotation_agg AS (
    SELECT
        spf.aip_id,
        spf.media_id,
        json_agg(
            json_build_object(
                'feature_id', spf.feature_id,
                'media_params', spf.media_params::json
            )
            ORDER BY spf.feature_id
        ) AS annotations
    FROM ai_store_product_feature spf
    WHERE spf.is_active = true
    GROUP BY spf.aip_id, spf.media_id
)

SELECT
    p.aip_id,
    p.shopify_product_id,
    p.product_title,
    s.seller_id,
    s.seller_shop_name AS shop,
    s.seller_name AS store_name,
    s.seller_name AS brand_name,
    s.logo_url,
    s.theme_color,
    s.text_color,

    dm.media_id,
    dm.media_url AS welcome_image,

    COALESCE(aa.annotations, '[]'::json) AS annotations,

    p.welcome_text

FROM ai_products p

JOIN sellers s
    ON s.seller_id = p.seller_id

LEFT JOIN ai_media_library dm
    ON dm.media_id = p.default_img_id

LEFT JOIN annotation_agg aa
    ON aa.aip_id = p.aip_id
   AND aa.media_id = dm.media_id

WHERE p.shopify_product_id = $1
  AND p.seller_id = $2

LIMIT 1;
"""

GET_SELLER_BY_CALL_ID_QUERY = """
SELECT
    o.ai_call_token,
    s.seller_name AS store_name
FROM ai_orders o
JOIN sellers s ON s.seller_id = o.seller_id
WHERE o.ai_call_token = $1
LIMIT 1;
"""

GET_SELLER_DATA_QUERY = """
SELECT seller_id, seller_name, logo_url, text_color, theme_color
FROM sellers
WHERE seller_id = $1;
"""

# ---------------------------------------------------------------------------
# Extracted Inline Queries
# ---------------------------------------------------------------------------

GET_CALL_COST_QUERY = "SELECT ai_id, call_cost FROM ai_orders WHERE ai_call_token = $1 LIMIT 1;"
UPDATE_CALL_COST_QUERY = "UPDATE ai_orders SET call_cost = $1 WHERE ai_call_token = $2;"
GET_ADVISORY_LOCK_QUERY = "SELECT pg_try_advisory_xact_lock($1)"

GET_ORDER_BY_TOKEN_QUERY = """
            SELECT 
                o.ai_id,
                o.ai_call_token,
                o.ai_status_code,
                o.ai_demo_date,
                o.seller_id,
                o.product_id,
                o.user_id,
                u.first_name,
                u.phone,
                p.product_title AS product_name,
                p.featured_image AS product_image,
                s.seller_name AS brand_name,
                s.logo_url AS brand_logo
            FROM ai_orders o
            LEFT JOIN users u ON u.user_id = o.user_id
            LEFT JOIN ai_products p ON p.shopify_product_id = o.product_id
            LEFT JOIN sellers s ON s.seller_id = o.seller_id
            WHERE o.ai_call_token = $1
            LIMIT 1;
            """

GET_ORDER_USER_BY_TOKEN_QUERY = "SELECT ai_id, user_id FROM ai_orders WHERE ai_call_token = $1 LIMIT 1;"
UPDATE_ORDER_DURATION_QUERY = "UPDATE ai_orders SET duration = $1 WHERE ai_id = $2;"
UPDATE_ORDER_STATUS_QUERY = "UPDATE ai_orders SET ai_status_code = $1 WHERE ai_id = $2 RETURNING ai_id;"
UPDATE_ORDER_INTENT_QUERY = "UPDATE ai_orders SET intent = $1 WHERE ai_call_token = $2;"

CHECK_ORDER_EXISTS_QUERY = "SELECT ai_id FROM ai_orders WHERE ai_call_token = $1 LIMIT 1;"
# Note: append_transcript has a slight variant without semicolon, we will capture it separately or use the same if possible
CHECK_ORDER_EXISTS_QUERY_NO_SEMI = "SELECT ai_id FROM ai_orders WHERE ai_call_token = $1 LIMIT 1"




GET_TRANSCRIPT_MESSAGES_QUERY = """
        SELECT "Role" as role, "Messages" as message, created_at
        FROM ai_transcript
        WHERE ai_id = $1
        ORDER BY created_at ASC;
        """

INSERT_ERROR_LOG_QUERY = """
            INSERT INTO error_logs (api_name, input_payload, db_error_text)
            VALUES ($1, $2, $3)
            RETURNING id;
            """

GET_USER_TOKEN_VALIDITY_QUERY = "SELECT user_id, token_validity FROM user_tokens WHERE access_token = $1 LIMIT 1;"
RESOLVE_SELLER_BY_ID_QUERY = "SELECT seller_id FROM sellers WHERE seller_id = $1 AND is_active = true LIMIT 1;"
RESOLVE_SELLER_BY_STORE_NAME_QUERY = "SELECT seller_id FROM seller_shopify_store WHERE store_name = $1 AND is_active = true LIMIT 1;"
RESOLVE_SELLER_BY_SHOP_NAME_QUERY = "SELECT seller_id FROM sellers WHERE seller_shop_name = $1 AND is_active = true LIMIT 1;"


GET_PRODUCT_IMAGE_QUERY = """
                SELECT featured_image
                FROM ai_products
                WHERE shopify_product_id = $1 AND seller_id = $2 AND is_active = true
                LIMIT 1;
                """

INSERT_AI_TOKEN_QUERY = """
            INSERT INTO ai_tokens (user_id, ai_access_token, refresh_token)
            VALUES ($1, $2, $3);
            """

CHECK_EXISTING_SESSION_QUERY = """
            SELECT ai_id, ai_call_token, ai_demo_date, ai_status_code
            FROM ai_orders
            WHERE user_id = $1 AND ai_status_code = 20
            ORDER BY ai_id DESC
            LIMIT 1;
            """

INSERT_AI_ORDER_QUERY = """
                INSERT INTO ai_orders (user_id, ai_status_code, ai_demo_date, seller_id, product_id, ai_call_token, utm_data)
                VALUES ($1, 20, CURRENT_DATE, $2, $3, $4, $5)
                RETURNING ai_id, ai_demo_date, ai_status_code, ai_call_token;
                """

INSERT_CART_DATA_QUERY = """
                INSERT INTO demo_cart_data (demo_id, demo_type, cart_data)
                VALUES ($1, $2, $3)
                ON CONFLICT (demo_id, demo_type)
                DO UPDATE SET cart_data = EXCLUDED.cart_data;
                """

INSERT_TRANSCRIPT_QUERY = """
            INSERT INTO ai_transcript (ai_id, "Role", "Messages", ai_call_token, created_at)
            VALUES ($1, $2, $3, $4, $5);
            """


INSERT_TRANSCRIPT_RETURNING_ID_QUERY = """
            INSERT INTO ai_transcript (ai_id, "Role", "Messages", ai_call_token, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING t_id;
            """
