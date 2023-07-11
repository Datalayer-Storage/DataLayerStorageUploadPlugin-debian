import yaml
import os
import sys

# Get the home directory from command line argument
user_home_dir = sys.argv[1]

chia_config_path = os.path.join(user_home_dir, ".chia/mainnet/config/config.yaml")

with open(chia_config_path, 'r') as stream:
    data = yaml.safe_load(stream)

if 'data_layer' not in data:
    data['data_layer'] = {'uploaders': []}

if 'uploaders' not in data['data_layer']:
    data['data_layer']['uploaders'] = []

if 'http://localhost:41410' not in data['data_layer']['uploaders']:
    data['data_layer']['uploaders'].append('http://localhost:41410')

with open(chia_config_path, 'w') as stream:
    yaml.safe_dump(data, stream)
