import sys, base64
path = sys.argv[1]
data = sys.stdin.read().strip()
with open(path, 'wb') as f: f.write(base64.b64decode(data))
print('OK: ' + path)
