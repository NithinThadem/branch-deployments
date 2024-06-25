FROM --platform=linux/amd64 node:18-slim
WORKDIR /usr/src/
COPY package.json ./
COPY yarn.lock ./
COPY .npmrc ./
COPY .puppeteerrc.cjs ./
# COPY service-account.json ./
COPY . ./

# Adds required libs
RUN apt-get update && \
    apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
    libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget

RUN yarn --frozen-lockfile --ignore-scripts
RUN yarn run tsc

# RUN chmod +x /usr/src/node_modules/@ffprobe-installer/linux-x64/ffprobe
# RUN chmod +x /usr/src/node_modules/@ffmpeg-installer/linux-x64/ffmpeg

RUN node node_modules/puppeteer/install.mjs

CMD [ "yarn", "start" ]
