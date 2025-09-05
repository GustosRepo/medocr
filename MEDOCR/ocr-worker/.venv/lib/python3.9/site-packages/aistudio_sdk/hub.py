# !/usr/bin/env python3
# -*- coding: UTF-8 -*-
################################################################################
#
# Copyright (c) 2023 Baidu.com, Inc. All Rights Reserved
#
################################################################################
"""
本文件实现了模型库hub接口封装

TODO: 
    当前脚本后续将移动至sdk目录下, 但用法将发生变化, 需和pm确认
    旧：
        from aistudio_sdk.hub import create_repo
        create_repo()
    新：
        from aistudio_sdk import hub
        hub.create_repo()

Authors: linyichong(linyichong@baidu.com)
Date:    2023/08/21
"""
from typing import Optional

import requests
import os
import logging
import traceback
from pathlib import Path
from aistudio_sdk.constant.err_code import ErrorEnum
from aistudio_sdk.requests.hub import request_aistudio_hub, request_aistudio_app_service
from aistudio_sdk.requests.hub import request_aistudio_git_file_info
from aistudio_sdk.requests.hub import request_aistudio_git_file_type
from aistudio_sdk.requests.hub import request_aistudio_git_upload_access
from aistudio_sdk.requests.hub import request_bos_upload
from aistudio_sdk.requests.hub import request_aistudio_git_upload_pointer
from aistudio_sdk.requests.hub import request_aistudio_git_upload_common
from aistudio_sdk.requests.hub import get_exist_file_old_sha
from aistudio_sdk.requests.hub import request_aistudio_repo_visible
from aistudio_sdk.requests.hub import request_aistudio_verify_lfs_file
from aistudio_sdk.utils.util import convert_to_dict_object, is_valid_host, calculate_sha256
from aistudio_sdk.utils.util import err_resp
from aistudio_sdk.utils.util import extract_yaml_block, is_readme_md
from aistudio_sdk import log
from aistudio_sdk import config
from aistudio_sdk.dot import post_upload_statistic
from typing import List


__all__ = [
    "create_repo",
    "upload",
    "file_exists"
]

class UploadFileException(Exception):
    """
    上传文件异常
    """
    pass

class Hub():
    """Hub类"""
    OBJECT_NAME = "hub"

    def __init__(self):
        """初始化函数，从本地磁盘加载AI Studio认证令牌。
        
        Args:
            无参数。
        
        Returns:
            无返回值。
        """

        # 当用户已经设置了AISTUDIO_ACCESS_TOKEN环境变量，那么优先读取环境变量，忽略本地磁盘存的token
        # 未设置时才读存本地token
        if not os.getenv("AISTUDIO_ACCESS_TOKEN", default=""):
            cache_home = os.getenv("AISTUDIO_CACHE_HOME", default=os.getenv("HOME"))
            token_file_path = f'{cache_home}/.cache/aistudio/.auth/token'
            if os.path.exists(token_file_path):
                with open(token_file_path, 'r') as file:
                    os.environ["AISTUDIO_ACCESS_TOKEN"] = file.read().strip()

    def create_repo(self, **kwargs):
        """
        创建一个repo仓库并返回创建成功后的信息。
        Params:
            repo_id (str): 仓库名称，格式为user_name/repo_name 或者 repo_name，必填。
            repo_type (str): 仓库类型，取值为app/model，分别为应用仓库和模型仓库。如果未指定，默认为model。
            app_name (str): 应用名称，如果repo_type为app，则必填。默认值为repo_id (如果不填，后端自动生成）。

            app_sdk (str): 应用SDK, 如果repo_type为app，则必填，可以填写 streamlit, gradio, static 三种
            version (str): streamlit 或 gradio 版本，必填
                * gradio版本支持"4.26.0", "4.0.0"
                * streamlit版本支持"1.33.0", "1.30.0"
            model_name (str): 模型名称，如果repo_type为model，则必填。默认值为repo_id。
            desc (str): 仓库描述，可选，默认为空。
            license (str): 仓库许可证，可选，默认为"Apache License 2.0"。
            private (bool): 是否私有仓库，可选，默认为False。
            token (str): 认证令牌，可选，默认为环境变量的值。
        Demo:
            创建应用仓库：
            create_repo(repo_id='app_repo_0425',
                        app_sdk='streamlit',
                        version="1.33.0"
                        desc='my app demo')
        Returns:
            dict: 仓库创建结果。
        """
        params = {}
        if "repo_id" not in kwargs:
            return err_resp(ErrorEnum.PARAMS_INVALID.code, ErrorEnum.PARAMS_INVALID.message)

        # 设置默认repo_type为'model'
        repo_type = kwargs.get('repo_type', 'model')
        if repo_type == 'app':
            if 'app_name' not in kwargs:
                return err_resp(ErrorEnum.PARAMS_INVALID.code,
                                ErrorEnum.PARAMS_INVALID.message + "should provide param app_name")

            app_sdk = kwargs.get('app_sdk')
            if not app_sdk or app_sdk not in ['streamlit', 'gradio', 'static']:
                return err_resp(ErrorEnum.PARAMS_INVALID.code,
                                ErrorEnum.PARAMS_INVALID.message + "app_sdk should be streamlit, gradio or static.")
            if app_sdk == "streamlit":
                if 'version' not in kwargs:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code,
                                    "streamlit version needed.")
                params["streamlitVersion"] = kwargs['version']

            if app_sdk == "gradio":
                if 'version' not in kwargs:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code,
                                    "gradio version needed.")
                params["gradioVersion"] = kwargs['version']

        elif repo_type == 'model' and 'model_name' not in kwargs:
            kwargs['model_name'] = kwargs.get('repo_id')

        if 'private' in kwargs and not isinstance(kwargs['private'], bool):
            return err_resp(ErrorEnum.PARAMS_INVALID.code, "private should be bool type.")

        for key in ['repo_id', 'model_name', 'license', 'token']:
            if key in kwargs:
                if not isinstance(kwargs[key], str):
                    return err_resp(ErrorEnum.PARAMS_INVALID.code, "should be str type: " + key)
                kwargs[key] = kwargs[key].strip()
                if not kwargs[key]:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code, "should not be empty: " + key)

        if not os.getenv("AISTUDIO_ACCESS_TOKEN") and 'token' not in kwargs:
            return err_resp(ErrorEnum.TOKEN_IS_EMPTY.code, ErrorEnum.TOKEN_IS_EMPTY.message)

        if 'desc' in kwargs and not isinstance(kwargs['desc'], str):
            return err_resp(ErrorEnum.PARAMS_INVALID.code, ErrorEnum.PARAMS_INVALID.message)

        repo_name_raw = kwargs['repo_id']
        if "/" in repo_name_raw:
            user_name, repo_name = repo_name_raw.split('/')
            user_name = user_name.strip()
            repo_name = repo_name.strip()
            if not repo_name or not user_name:
                return err_resp(ErrorEnum.PARAMS_INVALID.code,
                                "user_name or repo_name is empty. repo_id should be user_name/repo_name format.")
            kwargs['repo_id'] = repo_name
        else:
            kwargs['repo_id'] = repo_name_raw.strip()
            # return err_resp(ErrorEnum.PARAMS_INVALID.code,
            #                 "r epo_id should be user_name/repo_name format.")

        if repo_type == 'model':

            more_params = {
                'repoType': 0 if kwargs.get('private') else 1,
                'repoName': kwargs['repo_id'],
                'modelName': kwargs.get('model_name', ''),  # 添加模型名
                'desc': kwargs.get('desc', ''),
                'license': kwargs.get('license', 'Apache License 2.0'),
                'token': kwargs.get('token', '')
            }
            params.update(more_params)
            resp = convert_to_dict_object(request_aistudio_hub(**params))
        else:
            more_params = {
                'repoType': 0 if kwargs.get('private') else 1,
                'repoName': kwargs['repo_id'],
                'appName': kwargs.get('app_name', ''),
                'appType': kwargs.get('app_sdk', ''),
                'desc': kwargs.get('desc', ''),
                'license': kwargs.get('license', 'Apache License 2.0'),
                'token': kwargs.get('token', '')
            }
            params.update(more_params)

            resp_raw = request_aistudio_app_service(**params)
            log.debug(f"create_repo resp: {resp_raw}")
            resp = convert_to_dict_object(resp_raw)
            log.debug(f"create_repo resp dict: {resp}")

        if 'errorCode' in resp and resp['errorCode'] != 0:
            log.error(f"create_repo failed: {resp}")
            if "repo already created" in resp['errorMsg']:
                res = err_resp(ErrorEnum.REPO_ALREADY_EXIST.code, 
                               resp['errorMsg'],
                               resp['errorCode'],
                               resp['logId'])  # 错误logid透传
            else:
                res = err_resp(ErrorEnum.AISTUDIO_CREATE_REPO_FAILED.code, 
                               resp['errorMsg'],
                               resp['errorCode'],
                               resp['logId'])
            return res

        if repo_type == 'model':
            res = {
                'model_name': resp['result']['modelName'],
                'repo_id': resp['result']['repoName'],
                'private': True if resp['result']['repoType'] == 0 else False,
                'desc': resp['result']['desc'],
                'license': resp['result']['license']
            }
        else:
            res = {
                'app_id': resp['result']['appId'],
                'app_name': resp['result']['appName'],
                'repo_id': resp['result']['repoName'],
                'desc': resp['result']['desc'],
                'license': resp['result']['license']
            }
        return res

    def _upload_lfs_file(self, settings, file_path, file_size):
        """
        上传文件
        settings: 上传文件的配置信息
        settings = {
            'upload'[bool]: True or False
            'upload_href'[str]:  upload url
            'sts_token'[dict]: sts token
                {
                "bos_host":"",
                "bucket_name": "",
                "key":"",
                "access_key_id": "",
                "secret_access_key": "",
                "session_token": "",
                "expiration": ""
                }
        }
        file_path: 本地文件路径
        """
        if not settings.get('upload'):
            logging.info("file already exists, skip the upload.")
            return True

        upload_href = settings['upload_href']
        sts_token = settings.get('sts_token', {})
        is_sts_valid = False
        if sts_token and sts_token.get("bos_host"):
            is_sts_valid = True

        is_http_valid = True if upload_href and file_size < config.LFS_FILE_SIZE_LIMIT_PUT else False

        def _uploading_using_sts():
            """
            使用sts上传文件
            """
            from aistudio_sdk.utils.bos_sdk import sts_client, upload_file, upload_super_file
            try:
                client = sts_client(sts_token.get("bos_host"), sts_token.get("access_key_id"),
                           sts_token.get("secret_access_key"), sts_token.get("session_token"))
                res = upload_super_file(client,
                                        bucket=sts_token.get("bucket_name"), file=file_path, key=sts_token.get("key"))
                return res
            except Exception as e:
                raise UploadFileException(e)


        def _uploading_using_http():
            """
            使用http上传文件
            """
            try:
                res = request_bos_upload(upload_href, file_path)
                if 'error_code' in res and res['error_code'] != ErrorEnum.SUCCESS.code:
                    return res
                return True
            except Exception as e:
                raise UploadFileException(e)

        functions = []
        if is_sts_valid:
            functions.append(_uploading_using_sts)
        if is_http_valid:
            functions.append(_uploading_using_http)
        if not os.environ.get("PERFER_STS_UPLOAD", default="true") == "true":
            functions.reverse()
        if not functions:
            logging.error("no upload method available.")
            return False

        upload_success = False
        for func in functions:
            try:
                logging.info(f"uploading file using {func.__name__}")
                res = func()
                if res is True:
                    logging.info(f"upload lfs file success. {func.__name__}")
                    upload_success = True
                    break
                else:
                    logging.error(f"upload lfs file failed. {func.__name__}: {res}")
            except UploadFileException as e:
                logging.error(f"upload lfs file failed. {func.__name__}: {e}")
                logging.debug(traceback.format_exc())

        return upload_success


    def upload(self, **kwargs):
        """
        上传
        params:
            repo_id: 仓库id，格式为user_name/repo_name
            path_or_fileobj: 本地文件路径或文件对象
            path_in_repo: 上传的仓库中的文件路径
            revision: 分支名
            commit_message: 提交信息
            token: 认证令牌
        return:
            message
        """
        # 参数检查
        str_params_not_valid = 'params not valid.'
        print("uploading file, checking params ..")
        if "repo_id" not in kwargs or "path_or_fileobj" not in kwargs or "path_in_repo" not in kwargs:
            return err_resp(ErrorEnum.PARAMS_INVALID.code,
                            ErrorEnum.PARAMS_INVALID.message 
                            + "should provide param repo_id, path_or_fileobj and path_in_repo")

        for key in ['path_or_fileobj', 'repo_id', 'revision', 'path_in_repo', 
                    'commit_message', 'token']:
            if key in kwargs:
                if type(kwargs[key]) != str:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                                    ErrorEnum.PARAMS_INVALID.message + "should be str type: " + key)
                kwargs[key] = kwargs[key].strip()
                if not kwargs[key]:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                                    ErrorEnum.PARAMS_INVALID.message + "should not be empty: " + key)

        if not os.getenv("AISTUDIO_ACCESS_TOKEN") and 'token' not in kwargs:
            return err_resp(ErrorEnum.TOKEN_IS_EMPTY.code,
                            ErrorEnum.TOKEN_IS_EMPTY.message)

        revision = kwargs['revision'] if kwargs.get('revision') else 'master'
        commit_message = kwargs['commit_message'] if kwargs.get('commit_message') else ''
        token = kwargs['token'] if kwargs.get('token') else ''

        path_or_fileobj = Path(kwargs['path_or_fileobj'])
        path_in_repo = kwargs['path_in_repo']

        repo_id = kwargs['repo_id']
        if "/" not in repo_id:
            return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                            ErrorEnum.PARAMS_INVALID.message + "repo_name should be user_name/repo_name format.")

        user_name, repo_name = repo_id.split('/')
        user_name = user_name.strip()
        repo_name = repo_name.strip()
        if not repo_name or not user_name:
            return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                            ErrorEnum.PARAMS_INVALID.message + "repo_name or user_name is empty.")

        git_host = os.getenv("STUDIO_GIT_HOST", default=config.STUDIO_GIT_HOST_DEFAULT)
        if not is_valid_host(git_host):
            return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                            'git host not valid.')
        # 检查待上传文件在本地磁盘是否存在
        if not os.path.exists(path_or_fileobj):
            return err_resp(ErrorEnum.UPLOAD_FILE_NOT_FOUND.code,
                            'file not found in path. ' + str(path_or_fileobj))
        # 检查待上传文件类型，不能是folder（目录）
        if os.path.isdir(path_or_fileobj):
            return err_resp(ErrorEnum.UPLOAD_FOLDER_NO_SUPPORT.code,
                            'upload folder no support.' + str(path_or_fileobj))
        black_extensions = self._get_suffix_forbidden(repo_id)
        suffix = Path(path_or_fileobj).suffix.lower()
        if black_extensions and suffix in black_extensions:
            return err_resp(ErrorEnum.UPLOAD_FILE_FORBIDDEN.code,
                            'file type forbidden. ' + str(path_or_fileobj))
        if is_readme_md(file_path=path_or_fileobj) and revision == "master":
            try:
                url = "{}{}".format(
                    os.getenv("STUDIO_MODEL_API_URL_PREFIX", default=config.STUDIO_MODEL_API_URL_PREFIX_DEFAULT),
                    config.README_CHECK_URL)
                yaml_content = extract_yaml_block(path_or_fileobj)
                payload = {
                    "yaml": yaml_content,
                    "repoId": repo_id
                }
                headers = {
                    "Content-Type": "application/json"
                }
                response = requests.post(url, json=payload, headers=headers)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('errorCode') == 0:
                        log.debug(f"调用成功，logId:{data.get('logId')}")
                    else:
                        return data.get("errorMsg")
            except Exception as e:
                log.warn(f"check readme fail:{e}")
        print("checking file size ..")
        # 计算文件大小（byte）
        file_size = os.path.getsize(path_or_fileobj)

        
        # 第一步: 检查文件是否需要走LFS上传流程
        print("checking is file using lfs ..")
        res = request_aistudio_git_file_type(git_host, user_name, repo_name,
                                             revision, path_in_repo, token)
        if 'error_code' in res and res['error_code'] != ErrorEnum.SUCCESS.code:
            return res
        is_lfs = res['is_lfs']

        # 计算sha256
        sha256 = calculate_sha256(path_or_fileobj)

        if is_lfs:
            print("Start uploading LFS file.")
            # 第二步：申请上传LFS文件

            res = request_aistudio_git_upload_access(git_host, user_name, repo_name, revision,
                                                     file_size, sha256, token)
            logging.debug(f"request_aistudio_git_upload_access res: {res}")
            if 'error_code' in res and res['error_code'] != ErrorEnum.SUCCESS.code:
                return res

            # 第三步：上传LFS文件
            if res.get('upload'):

                upload_res = self._upload_lfs_file(res, path_or_fileobj, file_size)
                if not upload_res:
                    logging.error("upload lfs file failed. 文件上传终止")
                    return err_resp(ErrorEnum.GITEA_UPLOAD_FILE_FAILED.code, 
                                    f"lfs {ErrorEnum.GITEA_UPLOAD_FILE_FAILED.message}")

            else:
                # bos存储中该文件已存在。只需要再创建一次指针文件到指定分支即可。
                pass

            # 第四步：verify LFS file（判断文件是否存在）
            if res.get("verify_href"):
                verify_res = request_aistudio_verify_lfs_file(res.get("verify_href"), sha256, file_size)
                logging.info(f"verify lfs file res: {verify_res}")
                if 'error_code' in verify_res and verify_res['error_code'] != ErrorEnum.SUCCESS.code:
                    logging.error("verify lfs file failed. 文件上传终止")
                    return verify_res

            # 第五步：上传LFS指针文件（到仓库）
            lfs_res = request_aistudio_git_upload_pointer(git_host, user_name, repo_name, revision,
                                                    commit_message, sha256, file_size, path_in_repo,
                                                    token)
            if 'error_code' in lfs_res and lfs_res['error_code'] != ErrorEnum.SUCCESS.code:
                return lfs_res
            logging.info(f"upload lfs pointer file success")

        else:
            print("Start uploading common file.")
            # 如果大小超标，报错返回
            if file_size > config.COMMON_FILE_SIZE_LIMIT:
                return err_resp(ErrorEnum.FILE_TOO_LARGE.code,
                                ErrorEnum.FILE_TOO_LARGE.message + '(>5MB).')

            # 上传普通文件（到仓库）
            res = request_aistudio_git_upload_common(git_host, user_name, repo_name, revision,
                                                     commit_message, path_or_fileobj, path_in_repo,
                                                     token)
            if 'error_code' in res and res['error_code'] != ErrorEnum.SUCCESS.code:
                return res

        try:
            post_upload_statistic(token if token != '' else os.getenv("AISTUDIO_ACCESS_TOKEN", default=""),
                                  repo_id, path_in_repo, file_size)
        except Exception as e:
            log.debug(f"post upload dot fail{e}")
        return {'message': 'Upload Done.'}

    @staticmethod
    def _get_suffix_forbidden(repo_id) -> List[str]:
        try:
            url = "{}{}".format(
                os.getenv("STUDIO_MODEL_API_URL_PREFIX", default=config.STUDIO_MODEL_API_URL_PREFIX_DEFAULT),
                config.BLACK_LIST_URL
            )
            if repo_id:
                url = f"{url}?repoId={repo_id}"
            response = requests.get(url)
            if response.status_code == 200:
                r = response.json()
                if r['errorCode'] == 0:
                    return r['result']
                else:
                    return []
        except Exception as e:
            log.error(f"get black list fail:{e}")
        return []



    def file_exists(self, repo_id, filename, *args, **kwargs):
        """
        文件是否存在
        params:
            repo_id: 仓库id，格式为user_name/repo_name
            filename: 仓库中的文件路径
            revision: 分支名
            token: 认证令牌
        """
        # 参数检查
        str_params_not_valid = 'params not valid.'
        kwargs['repo_id'] = repo_id
        kwargs['filename'] = filename

        # 检查入参值的格式类型
        for key in ['filename', 'repo_id', 'revision', 'token']:
            if key in kwargs:
                if type(kwargs[key]) != str:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                                    ErrorEnum.PARAMS_INVALID.message)
                kwargs[key] = kwargs[key].strip()
                if not kwargs[key]:
                    return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                                    ErrorEnum.PARAMS_INVALID.message)
        revision = kwargs['revision'] if kwargs.get('revision') else 'master'
        file_path = kwargs['filename']
        token = kwargs['token'] if 'token' in kwargs else ''

        repo_name = kwargs['repo_id']
        if "/" not in repo_name:
            return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                            ErrorEnum.PARAMS_INVALID.message)

        user_name, repo_name = repo_name.split('/')
        user_name = user_name.strip()
        repo_name = repo_name.strip()
        if not repo_name or not user_name:
            return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                            ErrorEnum.PARAMS_INVALID.message)

        call_host = os.getenv("STUDIO_GIT_HOST", default=config.STUDIO_GIT_HOST_DEFAULT)
        if not is_valid_host(call_host):
            return err_resp(ErrorEnum.PARAMS_INVALID.code, 
                            'host not valid.')

        if os.environ.get("SKIP_REPO_VISIBLE_CHECK", default="false") != "true":
            # 检查仓库可见权限(他人的预发布仓库不能下载、查看)
            params = {
                'repoId': kwargs['repo_id'],
                'token': kwargs['token'] if 'token' in kwargs else ''
            }
            resp = convert_to_dict_object(request_aistudio_repo_visible(**params))
            if 'errorCode' in resp and resp['errorCode'] != 0:
                res = err_resp(ErrorEnum.AISTUDIO_NO_REPO_READ_AUTH.code,
                                resp['errorMsg'],
                                resp['errorCode'],
                                resp['logId'])
                return res

        # 查询文件是否存在
        info_res = request_aistudio_git_file_info(call_host, user_name, repo_name, file_path, 
                                                  revision, token)
        if get_exist_file_old_sha(info_res) == '':
            return False
        else:
            return True


def create_repo(**kwargs):
    """
    创建
    """
    return Hub().create_repo(**kwargs)


def upload(**kwargs):
    """
    上传
    """
    return Hub().upload(**kwargs)


def file_exists(repo_id, filename, *args, **kwargs):
    """
    检查云端文件存在与否
    """
    return Hub().file_exists(repo_id, filename, *args, **kwargs)
