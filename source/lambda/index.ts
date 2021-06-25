import * as AWS from "aws-sdk";

type Image = {
    repositoryName: string,
    imageTag?: string,
}

/**
 * @description: List the repositoryName and its' latest Tag from ECR
 * @param {*} event
 * @return {*} Example format of the return is  "Payload": [{"repositoryName": "python", "imageTag": "3.7"},
 *                                                          {"repositoryName": "alpine","imageTag": "latest"}]
 */
exports.handler = async (event: any) => {
    const params = {
        sourceType: process.env.SOURCE_TYPE,
        srcList: process.env.SRC_LIST,
        srcImageList: process.env.SELECTED_IMAGE_PARAM,
        srcRegion: process.env.SRC_REGION,
        srcAccountId: process.env.SRC_ACCOUNT_ID,
        srcCredentialName: process.env.SRC_CREDENTIAL_NAME
    }
    console.log(params)

    const ssm = new AWS.SSM();

    let result: Image[] = [];

    if (params.sourceType == "Amazon_ECR" && params.srcList == "ALL") {
        // Use ECR API to get the full list of repos and tags
        let opts: {
            [key: string]: any;
        } = {
            region: params.srcRegion,
        };
        // Get the AK/SK if source is NOT in current AWS account
        if (params.srcAccountId) {
            var secretName = params.srcCredentialName,
                secret: string,
                decodedBinarySecret;

            var client = new AWS.SecretsManager({
                apiVersion: '2017-10-17'
            });

            await client.getSecretValue({ SecretId: secretName! }, function (err, data) {
                if (err) {
                    if (err.code === 'DecryptionFailureException')
                        // Secrets Manager can't decrypt the protected secret text using the provided KMS key.
                        // Deal with the exception here, and/or rethrow at your discretion.
                        throw err;
                    else if (err.code === 'InternalServiceErrorException')
                        // An error occurred on the server side.
                        // Deal with the exception here, and/or rethrow at your discretion.
                        throw err;
                    else if (err.code === 'InvalidParameterException')
                        // You provided an invalid value for a parameter.
                        // Deal with the exception here, and/or rethrow at your discretion.
                        throw err;
                    else if (err.code === 'InvalidRequestException')
                        // You provided a parameter value that is not valid for the current state of the resource.
                        // Deal with the exception here, and/or rethrow at your discretion.
                        throw err;
                    else if (err.code === 'ResourceNotFoundException')
                        // We can't find the resource that you asked for.
                        // Deal with the exception here, and/or rethrow at your discretion.
                        throw err;
                }
                else {
                    // Decrypts secret using the associated KMS CMK.
                    // Depending on whether the secret is a string or binary, one of these fields will be populated.
                    if ('SecretString' in data) {
                        secret = data.SecretString!;
                    } else {
                        let buff = new Buffer(data.SecretBinary as string, 'base64');
                        decodedBinarySecret = buff.toString('ascii');
                    }
                }
                opts.accessKeyId = JSON.parse(secret).access_key_id
                opts.secretAccessKey = JSON.parse(secret).secret_access_key
            }).promise();
        }

        const ecr = new AWS.ECR(opts);

        const repos: string[] = await getECRRepositories(ecr);
        for (let repo of repos) {
            const imageTags = await getECRImageTags(repo, ecr);
            for (let tag of imageTags) {
                result.push({ "repositoryName": repo, "imageTag": tag.imageTags[0] });
            }
        }
    } else if (params.srcList == "SELECTED") {
        // Get the full list of repos and tags from SSM parameter
        const ssmImageList = await getSSMParameter(ssm, params.srcImageList, false);
        console.log(ssmImageList);

        result = await splitSelectedImages(ssmImageList);
    } else {
        console.log("sourceType is not (Amazon_ECR + ALL)/SELECTED, it is: " + params.sourceType + " " + params.srcList);
    }

    return { "Payload": result };
};

/**
 * @description: Using AWS ECR SDK 'describeRepositories' to get all repos in ECR
 * @return {*} All the images in the Repositiries
 */
async function getECRRepositories(ecr: AWS.ECR) {
    let repos: string[] = []
    for await (const data of listRepos({}, ecr)) {
        console.log(data.repositories);
        data.repositories?.forEach((repo: AWS.ECR.Repository, index: number) => {
            if (repo.repositoryName) {
                // console.log(repo.repositoryName)
                repos.push(repo.repositoryName)
            }
        })
    }
    return repos;
}

/**
 * @description: Using generator to get the repos based on the nextToken
 * @param {any} params
 * @return {*}
 */
async function* listRepos(params: any, ecr: AWS.ECR) {
    do {
        const data = await ecr.describeRepositories(params).promise();
        params.nextToken = data.nextToken;
        yield data;
    } while (params.nextToken);
}

/**
 * @description: Using AWS ECR SDK describeImages.
 * @param {*} params repositoryName
 * @return {*} latest tag of the input repo
 */
async function getECRImageTags(params: any, ecr: AWS.ECR) {
    let tags: any = []
    for await (const data of listImages(params, ecr)) {
        console.log(data.imageDetails);
        data.imageDetails?.forEach((img: AWS.ECR.ImageDetail, index: number) => {
            console.log(img)
            tags.push(img)
        })
    }
    return tags;
}

/**
 * @description: Using generator to get the tagged images based on the nextToken
 * @param {any} params
 * @return {*}
 */
async function* listImages(params: any, ecr: AWS.ECR) {
    var opts: any = {
        repositoryName: params,
        filter: { tagStatus: "TAGGED" },
    };
    do {
        const data = await ecr.describeImages(opts).promise();
        opts.nextToken = data.nextToken;
        yield data;
    } while (opts.nextToken);
}

/**
 * @description: Split the list into multiple entries of repository and tag
 * @param {*} srcImageList: String, like ubuntu:latest,alpine:latest,mydocker,test:version3
 * @return {*} The repos name and its version, if the input of a version is null, like "mydocker", the function will return {repositoryName:mydocker, imageTag:latest}
 */
async function splitSelectedImages(srcImageList: any) {

    console.log("input srcImageList: " + srcImageList);
    let result: Image[] = [];
    let imageList: string[] = srcImageList.replace(/(\r|\n|\ |\\n)/gm, "").split(",");

    imageList.forEach(image => {
        let sub_splitted = image.split(":");
        result.push({ repositoryName: sub_splitted[0], imageTag: sub_splitted[1] ? sub_splitted[1] : "latest" })
    })

    return result
}

/**
 * @description: 
 * @param {any} name
 * @param {boolean} decryptionFlag
 * @return {any} parameter value from the AWS SSM Parameter Store
 */
async function getSSMParameter(ssm: AWS.SSM, name: any, decryptionFlag: boolean) {
    const opts = {
        Name: name,
        WithDecryption: decryptionFlag
    };

    let result: any = ''
    await ssm.getParameter(opts, (err: any, data: AWS.SSM.Types.GetParameterResult) => {
        if (err) {
            console.log(err, err.stack); // an error occurred
        }
        else {
            result = data.Parameter?.Value
        }
    }).promise()
    return result
}