"""API endpoints for unspecified orchest-api level information."""
import secrets
import uuid

import yaml
from flask_restx import Namespace, Resource

from _orchest.internals import config as _config
from app import schema, utils
from app.connections import k8s_core_api
from config import CONFIG_CLASS

api = Namespace("ctl", description="Orchest-api internal control.")
api = utils.register_schema(api)


@api.route("/start-update")
class StartUpdate(Resource):
    @api.doc("orchest_api_start_update")
    @api.marshal_with(
        schema.update_sidecar_info,
        code=201,
        description="Update Orchest.",
    )
    def post(self):
        token = secrets.token_hex(20)
        update_pod_manifest = _get_update_pod_manifest()
        sidecar_manifest = _get_update_sidecar_manifest(
            update_pod_manifest["metadata"]["name"], token
        )
        # Create the sidecar first to avoid the risk of the update_pod
        # shutting down the orchest-api before that happens.
        k8s_core_api.create_namespaced_pod(_config.ORCHEST_NAMESPACE, sidecar_manifest)
        k8s_core_api.create_namespaced_pod(
            _config.ORCHEST_NAMESPACE, update_pod_manifest
        )

        data = {
            "token": token,
        }
        return data, 201


@api.route("/restart")
class Restart(Resource):
    @api.doc("orchest_api_restart")
    def post(self):
        restart_pod_manifest = _get_restart_pod_manifest()
        k8s_core_api.create_namespaced_pod(
            _config.ORCHEST_NAMESPACE, restart_pod_manifest
        )

        return {}, 201


@api.route("/orchest-images-to-pre-pull")
class OrchestImagesToPrePull(Resource):
    @api.doc("orchest_images_to_pre_pull")
    def get(self):
        """Orchest images to pre pull on all nodes for a better UX."""
        pre_pull_orchest_images = [
            f"orchest/jupyter-enterprise-gateway:{CONFIG_CLASS.ORCHEST_VERSION}",
            f"orchest/session-sidecar:{CONFIG_CLASS.ORCHEST_VERSION}",
            # This image is only used in the builder node, pull it
            # anyway through the daemonset? (it's around 50 MB).
            CONFIG_CLASS.IMAGE_BUILDER_IMAGE,
            utils.get_jupyter_server_image_to_use(),
        ]
        pre_pull_orchest_images = {"pre_pull_images": pre_pull_orchest_images}

        return pre_pull_orchest_images, 200


def _get_update_sidecar_manifest(update_pod_name, token: str) -> dict:
    return {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {
            "generateName": "update-sidecar-",
            "labels": {
                "app": "update-sidecar",
                "app.kubernetes.io/name": "update-sidecar",
                "app.kubernetes.io/part-of": "orchest",
                "app.kubernetes.io/release": "orchest",
            },
        },
        "spec": {
            "containers": [
                {
                    "env": [
                        {"name": "PYTHONUNBUFFERED", "value": "TRUE"},
                        {
                            "name": "POD_NAME",
                            "valueFrom": {
                                "fieldRef": {"fieldPath": "metadata.name"}
                            },
                        },
                        {"name": "UPDATE_POD_NAME", "value": update_pod_name},
                        {"name": "TOKEN", "value": token},
                    ],
                    "image": f"orchest/update-sidecar:{CONFIG_CLASS.ORCHEST_VERSION}",
                    "imagePullPolicy": "IfNotPresent",
                    "name": "update-sidecar",
                }
            ],
            "restartPolicy": "Never",
            "terminationGracePeriodSeconds": 1,
            "serviceAccount": "orchest-api",
            "serviceAccountName": "orchest-api",
        },
    }


def _get_orchest_ctl_pod_manifest(command_label: str) -> dict:
    with open(_config.ORCHEST_CTL_POD_YAML_PATH, "r") as f:
        manifest = yaml.safe_load(f)

    manifest["metadata"]["labels"]["version"] = CONFIG_CLASS.ORCHEST_VERSION
    manifest["metadata"]["labels"]["command"] = command_label

    containers = manifest["spec"]["containers"]
    orchest_ctl_container = containers[0]
    orchest_ctl_container[
        "image"
    ] = f"orchest/orchest-ctl:{CONFIG_CLASS.ORCHEST_VERSION}"
    for env_var in orchest_ctl_container["env"]:
        if env_var["name"] == "ORCHEST_VERSION":
            env_var["value"] = CONFIG_CLASS.ORCHEST_VERSION
            break

    # This is to know the name in advance.
    manifest["metadata"].pop("generateName", None)
    manifest["metadata"]["name"] = f"orchest-ctl-{uuid.uuid4()}"
    return manifest


def _get_update_pod_manifest() -> dict:
    # The update pod is of the same version of the cluster, it will stop
    # the cluster then spawn an hidden-update pod which will update to
    # the desired version.
    manifest = _get_orchest_ctl_pod_manifest("update")

    containers = manifest["spec"]["containers"]
    orchest_ctl_container = containers[0]

    orchest_ctl_container["command"] = ["/bin/bash", "-c"]
    # Make sure the sidecar is online before updating.
    orchest_ctl_container["args"] = [
        "while true; do nc -zvw1 update-sidecar 80 > /dev/null 2>&1 && orchest update "
        "&& break; sleep 1; done"
    ]

    return manifest


def _get_restart_pod_manifest() -> dict:
    manifest = _get_orchest_ctl_pod_manifest("restart")

    containers = manifest["spec"]["containers"]
    orchest_ctl_container = containers[0]
    orchest_ctl_container["command"] = ["/bin/bash", "-c"]
    # Make sure the sidecar is online before updating.
    orchest_ctl_container["args"] = ["orchest restart"]

    return manifest
