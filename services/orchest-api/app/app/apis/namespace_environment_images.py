from flask import abort
from flask.globals import current_app
from flask_restx import Namespace, Resource
from sqlalchemy import desc, func

from _orchest.internals import config as _config
from _orchest.internals.two_phase_executor import TwoPhaseFunction
from app import models, schema
from app.apis.namespace_environment_image_builds import DeleteProjectBuilds
from app.connections import db, k8s_core_api
from app.core import image_utils
from app.utils import register_schema

api = Namespace("environment-images", description="Managing environment images")
api = register_schema(api)


@api.route("/latest/<string:project_uuid>/<string:environment_uuid>")
@api.param("project_uuid", "uuid of the project")
@api.param("environment_uuid", "uuid of the environment")
class LatestProjectEnvironmentEnvironmentImage(Resource):
    @api.doc("get_latest_project_environment_environment_image")
    @api.marshal_with(schema.environment_image, code=200)
    def get(self, project_uuid, environment_uuid):
        """Fetches the latest built image for an environment."""
        env_image = (
            models.EnvironmentImage.query.filter_by(
                project_uuid=project_uuid,
                environment_uuid=environment_uuid,
            )
            .order_by(desc(models.EnvironmentImage.tag))
            .first()
        )
        if env_image is None:
            abort(404, "No image for for this environment.")
        return env_image


@api.route("/latest")
class LatestEnvironmentImage(Resource):
    @api.doc("get_latest_environment_image")
    @api.marshal_with(schema.environment_images, code=200)
    def get(self):
        """Fetches the latest built images for all environments."""
        latest_env_images = db.session.query(
            models.EnvironmentImage.project_uuid,
            models.EnvironmentImage.environment_uuid,
            func.max(models.EnvironmentImage.tag).label("tag"),
        ).group_by(
            models.EnvironmentImage.project_uuid,
            models.EnvironmentImage.environment_uuid,
        )
        latest_env_images = list(latest_env_images)
        return {"environment_images": latest_env_images}, 200


@api.route("/to-pre-pull")
class EnvironmentImagesToPrePull(Resource):
    @api.doc("get_environment_image_to_pre_pull")
    @api.marshal_with(schema.environment_images_to_pre_pull, code=200)
    def get(self):
        """Fetches the list of environment images to pre-pull."""
        latest_env_images = db.session.query(
            models.EnvironmentImage.project_uuid,
            models.EnvironmentImage.environment_uuid,
            func.max(models.EnvironmentImage.tag).label("tag"),
        ).group_by(
            models.EnvironmentImage.project_uuid,
            models.EnvironmentImage.environment_uuid,
        )
        registry_ip = k8s_core_api.read_namespaced_service(
            _config.REGISTRY, _config.ORCHEST_NAMESPACE
        ).spec.cluster_ip
        images_to_pre_pull = []
        for img in latest_env_images:
            image = f"{_config.ENVIRONMENT_IMAGE_NAME.format(project_uuid=img.project_uuid, environment_uuid=img.environment_uuid)}:{str(img.tag)}"
            images_to_pre_pull.append(f"{registry_ip}/{image}")

        return {"pre_pull_images": images_to_pre_pull}, 200


@api.route(
    "/dangling/<string:project_uuid>/<string:environment_uuid>",
)
@api.param("project_uuid", "UUID of the project")
@api.param("environment_uuid", "UUID of the environment")
class ProjectEnvironmentDanglingImages(Resource):
    @api.doc("delete-project-environment-dangling-images")
    def delete(self, project_uuid, environment_uuid):
        """Removes dangling images related to a project and environment.
        Dangling images are images that have been left nameless and
        tag-less and which are not referenced by any run
        or job which are pending or running."""

        return {"message": "Successfully removed dangling images."}, 200


class DeleteProjectEnvironmentImages(TwoPhaseFunction):
    def _transaction(self, project_uuid: str):
        # Cleanup references to the builds and dangling images of all
        # environments of this project.
        DeleteProjectBuilds(self.tpe).transaction(project_uuid)

        self.collateral_kwargs["project_uuid"] = project_uuid

    @classmethod
    def _background_collateral(cls, app, project_uuid):
        with app.app_context():
            image_utils.delete_project_dangling_images(project_uuid)

    def _collateral(self, project_uuid: str):
        # Needs to happen in the background because session shutdown
        # happens in the background as well. The scheduler won't be
        # given control if an endpoint is, for example, sleeping.
        current_app.config["SCHEDULER"].add_job(
            DeleteProjectEnvironmentImages._background_collateral,
            args=[current_app._get_current_object(), project_uuid],
        )
