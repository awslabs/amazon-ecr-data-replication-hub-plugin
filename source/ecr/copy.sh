#!/bin/sh

set -e

echo "[Init] Get Image Repo Name and Tag"
echo "repo is $IMAGE and tag is $TAG"

echo "[Init] Get ssm info"

# function to get AK/SK stored in SSM
# usage get_aksk param_name
get_aksk()
{
  echo "Get AK/SK in ssm"
  if [ -z "$1" ]; then
    echo "No credential is provided, no ak/sk"
    ak='0'
    sk='0'
  else
    echo "Get $1 from $AWS_DEFAULT_REGION"
    cred_ssm=$(aws ssm get-parameter --name $1 --with-decryption --region $AWS_DEFAULT_REGION)
    ak=$(echo $cred_ssm | jq -c '.Parameter.Value | fromjson | .access_key_id' | tr -d '"') 
    sk=$(echo $cred_ssm | jq -c '.Parameter.Value | fromjson | .secret_access_key' | tr -d '"')
  fi
}

get_aksk $SRC_CREDENTIAL
src_ak=$ak
src_sk=$sk
get_aksk $DEST_CREDENTIAL
dest_ak=$ak
dest_sk=$sk

# function to get ecr login password
# Usage: get_cred region account_id ak sk
get_cred()
{
  # echo "All params are $@"
  if [ -z "$4" ]; then
    # In current account
    echo "Get login pwd in region $1 in current account" 
    cred=`aws ecr get-login-password --region $1`
    ACCOUNT_ID=$AWS_ACCOUNT_ID
  else
    ACCOUNT_ID=$2
    echo "Read AK/SK"
    # echo $3
    # echo $4
    # export AWS_ACCESS_KEY_ID=$3
    # export AWS_SECRET_ACCESS_KEY=$4
    echo "Get login pwd in region $1"
    cred=$(AWS_ACCESS_KEY_ID=$3 AWS_SECRET_ACCESS_KEY=$4 AWS_DEFAULT_REGION=$1 aws ecr get-login-password --region $1)
    # echo "cred is $cred"
  fi

  # Get ecr domain name
  if [ "$1" = "cn-north-1" ] || [ "$1" = "cn-northwest-1" ]; then
    domain=$ACCOUNT_ID.dkr.ecr.$1.amazonaws.com.cn
  else
    domain=$ACCOUNT_ID.dkr.ecr.$1.amazonaws.com
  fi
  echo "domain is $domain"
}


echo "[Source] Get Source Info"
if [ "$SOURCE_TYPE" = "Amazon_ECR" ]; then
  echo "Source Type is ECR"
  get_cred $SRC_REGION $SRC_ACCOUNT_ID $src_ak $src_sk
  src_cred=$cred
  src_domain=$domain
  # echo "src_cred is $src_cred"
  # echo "src_domain is $src_domain"
else
  echo "Source Type is NOT Amazon ECR"
fi


echo "[Destination] Get Destination Info"

get_cred $DEST_REGION $DEST_ACCOUNT_ID $dest_ak $dest_sk 
dest_cred=$cred
dest_domain=$domain

# echo "dest_cred is $dest_cred"
# echo "dest_domain is $dest_domain"

echo "[Destination] Create ECR repo"
# echo "Create ecr repo $IMAGE"
if [ -n "$DEST_ACCOUNT_ID" ]; then
  echo "Set env"
  export AWS_ACCESS_KEY_ID=$dest_ak
  export AWS_SECRET_ACCESS_KEY=$dest_sk
  export AWS_DEFAULT_REGION=$DEST_REGION
fi
aws ecr create-repository --repository-name $IMAGE --region $DEST_REGION >/dev/null || true


echo "[Copy] Start copying"
start_time=$(date +%s)


# echo $dest_pwd | skopeo login --username AWS --password-stdin $dest_domain
if [ "$SOURCE_TYPE" = "Amazon_ECR" ]; then
  skopeo copy docker://$src_domain/$IMAGE:$TAG docker://$dest_domain/$IMAGE:$TAG --src-creds AWS:$src_cred --dest-creds AWS:$dest_cred
else
  skopeo copy docker://$IMAGE:$TAG docker://$dest_domain/$IMAGE:$TAG --dest-creds AWS:$dest_cred
fi

end_time=$(date +%s)
cost_time=`expr $end_time - $start_time` 
echo "Time elapsed to copy is $(($cost_time/60))min $(($cost_time%60))s"
