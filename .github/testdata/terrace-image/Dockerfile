# The smallest image that publishes a configuration contract: the document at the path its labels
# name, and the label region `terrace-contract render --format dockerfile --write` fills. Built
# from this directory, with no base image to pull.
FROM scratch
COPY contract.json /config/contract.json
# terrace-config:labels:begin
LABEL dev.terrace.config.contract.version="1" \
      dev.terrace.config.contract.path="/config/contract.json" \
      dev.terrace.config.prefix="ORDERS_"
# terrace-config:labels:end
