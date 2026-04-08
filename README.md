# GitHub Typescript Action

This is a base github action built using the github actions toolkit.

[GitHub Reference Project](https://github.com/actions/typescript-action)

## Customization

Update the template fields to name the action and set the ownership.

```bash
git checkout -b init-template-fields
REPO=$(basename -s .git `git config --get remote.origin.url`)
OWNER=myteamname
DESCRIPTION="A typescript action to do workflow stuff programmatically"
find . -type f -exec sed -i "s/{{ template\.name }}/$REPO/g" {} +
find . -type f -exec sed -i "s/{{ template\.description }}/$DESCRIPTION/g" {} +
find . -type f -exec sed -i "s/{{ template\.owner }}/$OWNER/g" {} +
git add -u
git commit -a -m "chore: initialize template fields"
git push
```

## Development

Install the dependencies

```bash
npm install
```

Build the typescript and package it for distribution

```bash
npm run build
```

Run the tests :heavy_check_mark:

```bash
$ npm test
...
```

## Publish Artifacts

**Actions are run from GitHub repos so we will check in the packed dist folder.**

Run [tsx](https://github.com/privatenumber/tsx) and push the results:

```bash
npm run build
git add dist
git commit -m "feat: cool new feature"
git push origin feat/cool-new-feature
```
