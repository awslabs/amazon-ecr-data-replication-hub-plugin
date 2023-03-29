# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import os
import logging

from util.ecr_helper import BaseHelper, ECRHelper

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    params = {
        'source_type': os.environ['SOURCE_TYPE'],
        'src_list': os.environ['SRC_LIST'],
        'src_image_list': os.environ['SELECTED_IMAGE_PARAM'],
        'src_region': os.environ['SRC_REGION'],
        'src_account_id': os.environ['SRC_ACCOUNT_ID'],
        'src_credential_name': os.environ['SRC_CREDENTIAL_NAME']
    }
    logger.info(params)

    result = []

    if params['source_type'] == 'Amazon_ECR':
        image_helper = ECRHelper(params)
        result = image_helper.generate_repo_tag_map_list()
    elif params['source_type'] != 'Amazon_ECR' and params['src_list'] == 'SELECTED':
        image_helper = BaseHelper(params)
        result = image_helper.generate_repo_tag_map_list()
    else:
        logger.info("sourceType is not (Amazon_ECR + X)/SELECTED, it is: " +
                        params['source_type'] + " " + params['src_list'])

    return {"Payload": result}

