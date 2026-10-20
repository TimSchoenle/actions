# terrace/helm-* fixture

A copy of the `mp-stats-legacy-viewer` chart from
[TimSchoenle/helm-charts](https://github.com/TimSchoenle/helm-charts), cut down to the files the
configuration contract gates read: its values, its templates, its declaration, the vendored
contract, the generated round-trip suite and the README template. It pins a real, signed image, so
`terrace-contract pull` can refresh its contract from the registry.

The `verify-action-terrace-helm-*` workflows run the actions against it. The templates are there
because the bindings gate reads them: a value bound to a contract key that no template renders is
refused. The chart is never rendered, so it does not declare the `common` library chart its
templates include. When the image is moved, copy the new `values.yaml` digest and
`contracts/viewer.json` together, or the pull job reports the contract as behind.
