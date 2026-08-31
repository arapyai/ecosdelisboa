from fastapi import APIRouter

from app.api.routes.admin_audio_bundles import router as admin_audio_bundles_router
from app.api.routes.admin_auth import router as admin_auth_router
from app.api.routes.admin_automation import router as admin_automation_router
from app.api.routes.admin_batches import router as admin_batches_router
from app.api.routes.admin_content import router as admin_content_router
from app.api.routes.admin_entity_translations import router as admin_entity_translations_router
from app.api.routes.admin_import import router as admin_import_router
from app.api.routes.admin_languages import router as admin_languages_router
from app.api.routes.admin_pronunciation import router as admin_pronunciation_router
from app.api.routes.admin_review_maps import router as admin_review_maps_router
from app.api.routes.admin_routes import router as admin_routes_router
from app.api.routes.admin_users import router as admin_users_router
from app.api.routes.health import router as health_router
from app.api.routes.public_authors import router as authors_router
from app.api.routes.public_languages import router as languages_router
from app.api.routes.public_points import router as points_router
from app.api.routes.public_routes import router as routes_router
from app.api.routes.public_voices import router as voices_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(admin_auth_router)
api_router.include_router(admin_audio_bundles_router)
api_router.include_router(admin_batches_router)
api_router.include_router(admin_automation_router)
api_router.include_router(admin_content_router)
api_router.include_router(admin_entity_translations_router)
api_router.include_router(admin_import_router)
api_router.include_router(admin_languages_router)
api_router.include_router(admin_pronunciation_router)
api_router.include_router(admin_routes_router)
api_router.include_router(admin_review_maps_router)
api_router.include_router(admin_users_router)
api_router.include_router(authors_router)
api_router.include_router(points_router)
api_router.include_router(routes_router)
api_router.include_router(languages_router)
api_router.include_router(voices_router)
